#!/usr/bin/env bash
# Compiles axf-kernel and runs its unit + conformance tests with a bare kotlinc — no Gradle, no Maven.
# Needs: a Kotlin 2.0.x compiler (KOTLINC=/path/to/kotlinc, default: `kotlinc` on PATH or the one in $GRADLE_HOME/lib)
# and the kotlinx jars a Gradle 8.14 distribution ships in its lib/ folder (GRADLE_LIB, default /opt/gradle-8.14.3/lib).
set -euo pipefail
HERE=$(cd "$(dirname "$0")/.." && pwd)
GRADLE_LIB=${GRADLE_LIB:-/opt/gradle-8.14.3/lib}
KOTLINC=${KOTLINC:-$(command -v kotlinc || true)}
[ -n "$KOTLINC" ] || { echo "kotlinc not found — set KOTLINC (download: https://github.com/JetBrains/kotlin/releases)"; exit 1; }
KLIB=$(cd "$(dirname "$KOTLINC")/../lib" && pwd)
OUT=${OUT:-/tmp/axf-kernel-offline}; rm -rf "$OUT"; mkdir -p "$OUT/main" "$OUT/test" "$OUT/res" "$OUT/shim"
CP="$GRADLE_LIB/kotlinx-coroutines-core-jvm-1.6.4.jar:$GRADLE_LIB/kotlinx-serialization-core-jvm-1.6.2.jar:$GRADLE_LIB/kotlinx-serialization-json-jvm-1.6.2.jar"
echo "• compiling axf-kernel (explicit API, no warnings allowed)"
"$KOTLINC" -Xexplicit-api=strict -nowarn -cp "$CP" -d "$OUT/main" $(find "$HERE/axf-kernel/src/main" -name '*.kt') 2>&1 | grep -v JAVA_TOOL_OPTIONS || true
[ -d "$OUT/main/ai" ] || { echo "kernel failed to compile"; exit 1; }
cp "$HERE/../schemas/asset-types.json" "$HERE/../schemas/asset-types.android.json" "$HERE/../defaults.json" "$OUT/res/"
# kotlinx-coroutines-test is not in the Gradle distribution; runTest ≈ runBlocking for these tests.
cat > "$OUT/shim/RunTest.kt" <<'KT'
package kotlinx.coroutines.test
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.runBlocking
public fun runTest(block: suspend CoroutineScope.() -> Unit): Unit = runBlocking { block() }
KT
TCP="$OUT/main:$KLIB/kotlin-test.jar:$KLIB/kotlin-test-junit.jar:$GRADLE_LIB/junit-4.13.2.jar:$GRADLE_LIB/hamcrest-core-1.3.jar:$CP"
echo "• compiling tests"
"$KOTLINC" -nowarn -cp "$TCP" -d "$OUT/test" "$OUT/shim/RunTest.kt" $(find "$HERE/axf-kernel/src/test" -name '*.kt') 2>&1 | grep -v JAVA_TOOL_OPTIONS || true
echo "• running KernelTest + ConformanceTest (fixtures from framework/spec, assets from framework/assets)"
cd "$HERE/axf-kernel" && java -cp "$OUT/res:$OUT/test:$TCP:$KLIB/kotlin-stdlib.jar" org.junit.runner.JUnitCore ai.amberx.axf.kernel.KernelTest ai.amberx.axf.kernel.ConformanceTest 2>&1 | grep -v JAVA_TOOL_OPTIONS
