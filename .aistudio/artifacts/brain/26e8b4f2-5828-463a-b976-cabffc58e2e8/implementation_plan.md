# Implementation Plan: CyberEye Scanner Rebuild (V2)

Following user feedback, I will rebuild the `CyberEye` component to implement the Scanner Node effect consistently across the main Orb and MiniOrb, while re-styling the status labels to match the neon blue/black cyber-tech theme.

## Steps
1.  **Redesign `CyberEye.tsx`**:
    -   Completely remove mechanical aperture elements.
    -   Implement the "Scanner Node" horizontal light-sweep animation (`Scanner Blade`) as the primary feature.
    -   Integrate high-tech status label overlays ("LIVE", "AI CORE STATUS") using neon blue text on a black background to match the theme.
    -   Ensure consistent performance across both main Orb and `MiniOrb`.
2.  **Implementation Details**:
    -   **Animation**: Use a synchronized CSS `keyframes` animation for the scanner blade, tied to the `active` or `speaking` state.
    -   **Styling**: Use Tailwind classes or inline styles for neon-blue (`#00f0ff` or similar theme color) text on dark backgrounds (`bg-black`).
3.  **Verification**:
    -   Verify the scanner effect works in both the chat interface (main orb) and the top-header orb (MiniOrb).
    -   Verify status labels are readable, themed correctly, and do not obstruct the primary orb visuals.
