package ai.amberx.droid;

import android.content.Context;
import android.media.AudioFormat;
import android.media.MediaCodec;
import android.media.MediaExtractor;
import android.media.MediaFormat;
import android.media.MediaMuxer;
import android.net.Uri;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import java.io.FileDescriptor;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.channels.FileChannel;
import java.util.concurrent.CancellationException;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Audio Extract's engine (plugin `apps/console-web/plugins/audio-extract`, web side `web/core.ts`). Two ways out of a
 * video, nothing else:
 *  - {@link #copyAac}: the AAC track copied sample by sample into an MP4 audio file (.m4a) with MediaExtractor +
 *    MediaMuxer. No decode, no encode: lossless and fast. A track that isn't AAC is refused (the person picks WAV).
 *  - {@link #decodeWav}: the track decoded with MediaCodec to 16-bit PCM in a WAV file, trimmed to the sample.
 * Both trim to [startUs, endUs) and report progress 0–1; a set `cancel` stops them with CancellationException.
 */
final class AudioExtractor {
    interface Progress { void on(double p); }

    static final String AAC = "audio/mp4a-latm";

    private AudioExtractor() {}

    /** Length (ms) and the audio tracks of a video. */
    static JSObject probe(Context ctx, Uri uri) throws IOException {
        MediaExtractor ex = new MediaExtractor();
        try {
            ex.setDataSource(ctx, uri, null);
            long durUs = 0;
            JSArray tracks = new JSArray();
            for (int i = 0; i < ex.getTrackCount(); i++) {
                MediaFormat f = ex.getTrackFormat(i);
                String mime = f.getString(MediaFormat.KEY_MIME);
                long d = f.containsKey(MediaFormat.KEY_DURATION) ? f.getLong(MediaFormat.KEY_DURATION) : 0;
                durUs = Math.max(durUs, d);
                if (mime == null || !mime.startsWith("audio/")) continue;
                JSObject t = new JSObject();
                t.put("index", i);
                t.put("mime", mime);
                t.put("channels", f.containsKey(MediaFormat.KEY_CHANNEL_COUNT) ? f.getInteger(MediaFormat.KEY_CHANNEL_COUNT) : 0);
                t.put("sampleRate", f.containsKey(MediaFormat.KEY_SAMPLE_RATE) ? f.getInteger(MediaFormat.KEY_SAMPLE_RATE) : 0);
                if (f.containsKey(MediaFormat.KEY_BIT_RATE)) t.put("bitrate", f.getInteger(MediaFormat.KEY_BIT_RATE));
                if (f.containsKey(MediaFormat.KEY_LANGUAGE)) t.put("language", f.getString(MediaFormat.KEY_LANGUAGE));
                if (d > 0) t.put("durationMs", d / 1000);
                tracks.put(t);
            }
            JSObject out = new JSObject();
            out.put("durationMs", durUs / 1000);
            out.put("tracks", tracks);
            return out;
        } finally {
            ex.release();
        }
    }

    private static MediaFormat audioTrack(MediaExtractor ex, int track) throws IOException {
        if (track < 0 || track >= ex.getTrackCount()) throw new IOException("That audio track isn’t in this video.");
        MediaFormat f = ex.getTrackFormat(track);
        String mime = f.getString(MediaFormat.KEY_MIME);
        if (mime == null || !mime.startsWith("audio/")) throw new IOException("Track " + (track + 1) + " isn’t audio.");
        return f;
    }

    private static long endOf(MediaFormat f, long endUs) {
        if (endUs > 0) return endUs;
        return f.containsKey(MediaFormat.KEY_DURATION) ? f.getLong(MediaFormat.KEY_DURATION) : Long.MAX_VALUE;
    }

    private static double fraction(long t, long start, long end) {
        if (end == Long.MAX_VALUE || end <= start) return 0;
        return Math.max(0, Math.min(1, (double) (t - start) / (double) (end - start)));
    }

    /** Lossless: the AAC samples into an .m4a. Returns the length written (ms). */
    static long copyAac(Context ctx, Uri src, int track, long startUs, long endUs, FileDescriptor out, Progress progress, AtomicBoolean cancel) throws IOException {
        MediaExtractor ex = new MediaExtractor();
        MediaMuxer mux = null;
        boolean started = false;
        try {
            ex.setDataSource(ctx, src, null);
            MediaFormat f = audioTrack(ex, track);
            String mime = f.getString(MediaFormat.KEY_MIME);
            if (!AAC.equals(mime)) throw new IOException("This audio is " + mime.replace("audio/", "") + ", which can’t be copied into an .m4a as is. Pick WAV.");
            ex.selectTrack(track);
            long end = endOf(f, endUs);
            if (startUs > 0) ex.seekTo(startUs, MediaExtractor.SEEK_TO_PREVIOUS_SYNC);
            mux = new MediaMuxer(out, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4);
            int dst = mux.addTrack(f);
            int max = f.containsKey(MediaFormat.KEY_MAX_INPUT_SIZE) ? f.getInteger(MediaFormat.KEY_MAX_INPUT_SIZE) : 0;
            ByteBuffer buf = ByteBuffer.allocateDirect(Math.max(max, 256 * 1024));
            MediaCodec.BufferInfo info = new MediaCodec.BufferInfo();
            mux.start();
            started = true;
            long first = -1, last = 0;
            while (true) {
                if (cancel.get()) throw new CancellationException();
                buf.clear();
                int n = ex.readSampleData(buf, 0);
                if (n < 0) break;
                long t = ex.getSampleTime();
                if (t >= end) break;
                if (t < startUs) { ex.advance(); continue; } // every AAC frame stands alone: start on the first one in range
                if (first < 0) first = t;
                info.set(0, n, t - first, MediaCodec.BUFFER_FLAG_KEY_FRAME);
                mux.writeSampleData(dst, buf, info);
                last = t - first;
                progress.on(fraction(t, startUs, end));
                ex.advance();
            }
            if (first < 0) throw new IOException("There’s no audio in that part of the video.");
            mux.stop();
            started = false;
            return last / 1000;
        } finally {
            ex.release();
            if (mux != null) {
                try { if (started) mux.stop(); } catch (RuntimeException ignored) { /* a failed file is deleted by the caller */ }
                try { mux.release(); } catch (RuntimeException ignored) { /* already released */ }
            }
        }
    }

    /** Decoded: 16-bit PCM in a WAV file, trimmed to the sample. Returns the length written (ms). */
    static long decodeWav(Context ctx, Uri src, int track, long startUs, long endUs, FileDescriptor out, Progress progress, AtomicBoolean cancel) throws IOException {
        MediaExtractor ex = new MediaExtractor();
        MediaCodec dec = null;
        try (FileOutputStream os = new FileOutputStream(out)) {
            FileChannel ch = os.getChannel();
            ex.setDataSource(ctx, src, null);
            MediaFormat f = audioTrack(ex, track);
            ex.selectTrack(track);
            long end = endOf(f, endUs);
            int channels = f.getInteger(MediaFormat.KEY_CHANNEL_COUNT);
            int rate = f.getInteger(MediaFormat.KEY_SAMPLE_RATE);
            dec = MediaCodec.createDecoderByType(f.getString(MediaFormat.KEY_MIME));
            dec.configure(f, null, null, 0);
            dec.start();
            ch.position(0);
            ch.write(ByteBuffer.allocate(44)); // header written at the end, once the size is known
            if (startUs > 0) ex.seekTo(startUs, MediaExtractor.SEEK_TO_PREVIOUS_SYNC);
            MediaCodec.BufferInfo info = new MediaCodec.BufferInfo();
            boolean inDone = false, outDone = false;
            long dataBytes = 0;
            while (!outDone) {
                if (cancel.get()) throw new CancellationException();
                if (!inDone) {
                    int ii = dec.dequeueInputBuffer(10_000);
                    if (ii >= 0) {
                        ByteBuffer ib = dec.getInputBuffer(ii);
                        int n = ib == null ? -1 : ex.readSampleData(ib, 0);
                        long t = ex.getSampleTime();
                        if (n < 0 || t >= end) {
                            dec.queueInputBuffer(ii, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM);
                            inDone = true;
                        } else {
                            dec.queueInputBuffer(ii, 0, n, t, 0);
                            ex.advance();
                        }
                    }
                }
                int oi = dec.dequeueOutputBuffer(info, 10_000);
                if (oi == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
                    MediaFormat of = dec.getOutputFormat();
                    if (of.containsKey(MediaFormat.KEY_CHANNEL_COUNT)) channels = of.getInteger(MediaFormat.KEY_CHANNEL_COUNT);
                    if (of.containsKey(MediaFormat.KEY_SAMPLE_RATE)) rate = of.getInteger(MediaFormat.KEY_SAMPLE_RATE);
                    if (of.containsKey(MediaFormat.KEY_PCM_ENCODING) && of.getInteger(MediaFormat.KEY_PCM_ENCODING) != AudioFormat.ENCODING_PCM_16BIT)
                        throw new IOException("This phone’s decoder doesn’t give 16-bit audio for this track.");
                } else if (oi >= 0) {
                    ByteBuffer ob = dec.getOutputBuffer(oi);
                    if (ob != null && info.size > 0) {
                        int frame = 2 * channels;
                        long t = info.presentationTimeUs;
                        long skip = t < startUs ? ((startUs - t) * rate / 1_000_000L) * frame : 0;
                        long keep = info.size - Math.min(skip, info.size);
                        if (end != Long.MAX_VALUE) {
                            long room = ((end - Math.max(t, startUs)) * rate / 1_000_000L) * frame;
                            keep = Math.min(keep, Math.max(0, room));
                        }
                        if (keep > 0) {
                            ob.position(info.offset + (int) Math.min(skip, info.size));
                            ob.limit(ob.position() + (int) keep);
                            while (ob.hasRemaining()) ch.write(ob);
                            dataBytes += keep;
                        }
                        progress.on(fraction(t, startUs, end));
                    }
                    dec.releaseOutputBuffer(oi, false);
                    if ((info.flags & MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0) outDone = true;
                }
            }
            if (dataBytes == 0) throw new IOException("There’s no audio in that part of the video.");
            ch.position(0);
            ch.write(wavHeader(dataBytes, rate, channels));
            os.flush();
            return dataBytes * 1000L / ((long) rate * channels * 2);
        } finally {
            ex.release();
            if (dec != null) {
                try { dec.stop(); } catch (RuntimeException ignored) { /* not started */ }
                dec.release();
            }
        }
    }

    static ByteBuffer wavHeader(long dataBytes, int rate, int channels) {
        ByteBuffer h = ByteBuffer.allocate(44).order(ByteOrder.LITTLE_ENDIAN);
        long riff = Math.min(0xFFFFFFFFL, 36 + dataBytes);
        h.put(new byte[] { 'R', 'I', 'F', 'F' }).putInt((int) riff).put(new byte[] { 'W', 'A', 'V', 'E' });
        h.put(new byte[] { 'f', 'm', 't', ' ' }).putInt(16).putShort((short) 1).putShort((short) channels)
            .putInt(rate).putInt(rate * channels * 2).putShort((short) (channels * 2)).putShort((short) 16);
        h.put(new byte[] { 'd', 'a', 't', 'a' }).putInt((int) Math.min(0xFFFFFFFFL, dataBytes));
        h.flip();
        return h;
    }
}
