package ai.amberx.consoleapp;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;

import org.junit.Test;

/** The toolbar and the expanded console inside the safe area, portrait and landscape (part 2, s4). */
public class SafeAreaTest {
    // {top, right, bottom, left}
    static final int[] PORTRAIT = { 110, 0, 63, 0 };         // status bar + punch hole on top, gesture bar below
    static final int[] LAND_LEFT_CUT = { 60, 126, 0, 110 };  // camera on the left, 3-button nav bar on the right
    static final int[] KEYBOARD = { 110, 0, 900, 0 };

    @Test public void toolbarClearsTheSideCutoutAndNavBar() {
        assertEquals(0, SafeArea.toolbarX("end", PORTRAIT));
        assertEquals(126, SafeArea.toolbarX("end", LAND_LEFT_CUT));
        assertEquals(110, SafeArea.toolbarX("start", LAND_LEFT_CUT));
        assertEquals(0, SafeArea.toolbarX("start", null));
    }

    @Test public void toolbarStaysBetweenTheStatusBarAndTheBottomBar() {
        assertEquals(110, SafeArea.toolbarY(0, 3000, 120, PORTRAIT));          // not under the clock or the camera
        assertEquals(900, SafeArea.toolbarY(30, 3000, 120, PORTRAIT));
        assertEquals(2700, SafeArea.toolbarY(90, 3000, 120, PORTRAIT));
        assertEquals(1000 - 63 - 120, SafeArea.toolbarY(90, 1000, 120, PORTRAIT)); // not under the gesture bar
        assertEquals(3000 - 900 - 120, SafeArea.toolbarY(90, 3000, 120, KEYBOARD)); // above the keyboard
        assertEquals(60, SafeArea.clampY(-50, 1400, 120, LAND_LEFT_CUT));
        assertEquals(1400 - 120, SafeArea.clampY(5000, 1400, 120, LAND_LEFT_CUT));
        // a screen too small for the band: the top wins
        assertEquals(110, SafeArea.clampY(500, 200, 120, PORTRAIT));
    }

    @Test public void dockedToolbarSitsInTheSafeTopLeftCorner() {
        assertArrayEquals(new int[] { 0, 110 }, SafeArea.dock(PORTRAIT));
        assertArrayEquals(new int[] { 110, 60 }, SafeArea.dock(LAND_LEFT_CUT));
    }

    @Test public void paddingAndPageTokensNeverCountASideTwice() {
        // the page doesn't pad itself: the shell pads all four sides, the page gets zeros
        assertArrayEquals(new int[] { 0, 110 + 90, 0, 63 }, SafeArea.rootPadding(PORTRAIT, 90, false));
        assertArrayEquals(new int[4], SafeArea.pageInsets(PORTRAIT, 90, false));
        // the page pads itself, nothing docked: the page gets the real insets
        assertArrayEquals(new int[4], SafeArea.rootPadding(LAND_LEFT_CUT, 0, true));
        assertArrayEquals(LAND_LEFT_CUT, SafeArea.pageInsets(LAND_LEFT_CUT, 0, true));
        // docked: the shell owns the top strip (status bar + toolbar), the page the other three sides
        assertArrayEquals(new int[] { 0, 60 + 90, 0, 0 }, SafeArea.rootPadding(LAND_LEFT_CUT, 90, true));
        assertArrayEquals(new int[] { 0, 126, 0, 110 }, SafeArea.pageInsets(LAND_LEFT_CUT, 90, true));
        // negative values never leak
        assertArrayEquals(new int[4], SafeArea.pageInsets(new int[] { -1, -2, -3, -4 }, 0, true));
    }
}
