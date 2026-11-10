package ai.amberx.droid;

import android.app.Activity;
import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import android.webkit.CookieManager;

/**
 * The tap on an axHub card for an `amberx.open_url` call (console wake: "a console command is waiting"): opens the page
 * in Chrome (or the default browser) at once and says yes to the call, never the AmberX app (Brett, Nov 10 2026: "It
 * says a command is waiting for you. I clicked it. I'm in the AmberX app.").
 *
 * The call only opens that page, so Brett's tap is his yes: a held call is approved now, a pending approval approved.
 * When the hub then hands the call to the phone, {@link AxppLink} sees the page was already opened from the tap and
 * doesn't open it a second time. Invisible (translucent, no history): a notification tap may start an activity, and
 * an activity on screen may start the browser, so Android's background-start block never applies here.
 */
public final class OpenPageActivity extends Activity {
    static final String EXTRA_URL = "ai.amberx.droid.PAGE_URL";
    static final String EXTRA_ID = "ai.amberx.droid.PAGE_CALL";
    static final String EXTRA_KIND = "ai.amberx.droid.PAGE_KIND";
    static final String KIND_HELD = "held", KIND_APPROVAL = "approval";

    /** The tap intent for one card: the page plus the call it answers. */
    static Intent intent(Context c, String url, String callId, String kind) {
        return new Intent(c, OpenPageActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_NO_ANIMATION)
            .putExtra(EXTRA_URL, url).putExtra(EXTRA_ID, callId).putExtra(EXTRA_KIND, kind);
    }

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        Intent in = getIntent();
        String url = OpenUrlRules.linkOr(in == null ? "" : in.getStringExtra(EXTRA_URL), HubRules.CONSOLE);
        String id = in == null ? null : in.getStringExtra(EXTRA_ID);
        String kind = in == null ? null : in.getStringExtra(EXTRA_KIND);
        OpenUrlRules.markTapped(url, System.currentTimeMillis());
        try { startActivity(AxppLink.browserIntent(this, url, "chrome")); } catch (RuntimeException ignored) { /* no browser at all */ }
        Context app = getApplicationContext();
        app.getSystemService(NotificationManager.class).cancel(AxppLink.NOTE_OPEN);
        if (id != null) new Thread(() -> answer(app, id, kind), "amberx-open-page").start();
        finish();
        overridePendingTransition(0, 0);
    }

    /** Brett's yes to the call that would have opened the page (best effort: the page is open either way). */
    private static void answer(Context app, String id, String kind) {
        try {
            if (KIND_HELD.equals(kind)) {
                int code = VetoAlerts.act(app, id, "approve-now");
                AmberxNativePlugin.vetoEvent(id, code == 200 ? "approved" : "failed", code == 200 ? null : "the page is open; the hub answered " + code);
            } else if (KIND_APPROVAL.equals(kind)) {
                if (HubRules.approve(HubRules.HUB, id, CookieManager.getInstance().getCookie(HubRules.HUB))) app.getSystemService(NotificationManager.class).cancel(id, 0);
            }
        } catch (RuntimeException ignored) { /* signed out or offline: the page is open, the call runs or expires on the hub */ }
    }
}
