package ai.amberx.consoleapp;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class InsetsCssTest {
    @Test public void setsAllFourTokens() {
        String s = InsetsCss.script(32, 0, 24, 48);
        assertTrue(s.contains("s.setProperty('--fx-safe-top','32px');"));
        assertTrue(s.contains("s.setProperty('--fx-safe-right','0px');"));
        assertTrue(s.contains("s.setProperty('--fx-safe-bottom','24px');"));
        assertTrue(s.contains("s.setProperty('--fx-safe-left','48px');"));
        assertTrue(s.contains("data-axf-shell','android'"));
    }

    @Test public void neverNegative() {
        assertTrue(InsetsCss.script(-5, 0, 0, 0).contains("'--fx-safe-top','0px'"));
    }

    @Test public void tokensMatchTheFrameworkCss() {
        // framework/ui/axf.css declares exactly these (check-console-droid.mjs reads both sides)
        assertEquals("--fx-safe-top", InsetsCss.TOKENS[0]);
        assertEquals("--fx-safe-left", InsetsCss.TOKENS[3]);
    }
}
