# Comprehensive Implementation Plan: Chat Interface UI & UX Refinements

This plan addresses all 8 requested UI and functional improvements across `src/routes/chat.tsx` (and `src/components/desktop/DesktopChatPanel.tsx` for consistency).

---

### 1. Prompt Box / Textbox Border Behavior
- **Requirement**: Outer border ring is dark grey at rest (`border-border` / `border-white/15`). It highlights to neon blue (`border-primary` / `focus:border-primary`) only when the user taps or types inside it.
- **Change in `chat.tsx`**: Update textarea className:
  `border border-border/40 focus:border-primary focus:ring-1 focus:ring-primary/50 transition-colors`

---

### 2. Process Stop & Send Buttons
- **Send Button**:
  - Current: Sky-blue solid background with white icon.
  - New: Matches other buttons: **black interior** (`bg-black` or `bg-background`), **neon blue outer ring** (`border border-primary/50` with hover/active state), and **blue Send icon** (`text-primary` with `<Send className="w-5 h-5 text-primary" />`).
- **Stop Button**:
  - Keep square process stop button, but add the missing **outer blue ring** (`border border-primary/50 hover:border-primary`).

---

### 3. Burger Navigation Popup (Tools Menu)
- **Requirement**: Return the items inside the burger dropdown (`Reminder`, `Notes`, `Bills`, etc.) back to their original glass style without the added individual outer blue rings.
- **Change**: Revert the tool items to `glass` without `border border-primary/30`.

---

### 4. Auto-Scroll Down on Thinking / Animations
- **Requirement**: When a message is sent and Alpha's thinking / processing animations are showing, the chat window should automatically scroll to the bottom so the animation is immediately visible.
- **Change**: Add a reactive `useEffect` watching `busy` and `act` (activity state). Whenever Alpha transitions to thinking, searching, or speaking, call `scrollToBottom(true)`.

---

### 5. Adaptive Scroll Button Visibility
- **Requirement**: The instant scroll up/down button must NOT be visible while Alpha is running a response or showing animations. It should only appear when the user is manually scrolling.
- **Change**: Update condition:
  `{adaptiveScroll && !busy && act.kind === "idle" && ( ... )}`

---

### 6 & 7. Mode Selector Buttons & Dropdown
- **Requirement**:
  - Keep the thunder/zap icon (`<Zap className="w-3.5 h-3.5 text-primary shrink-0" />`).
  - Button 1: **"Mode"** toggle button. Black background, black text (`bg-black text-black border border-primary/40` or clean themed variant as specified: black inside, black words for Mode).
  - Button 2: **Current Mode Display** (shows active mode: `Auto`, `⚡ Fast`, `🧠 Deep`, `🛠 Code`). Black inside, blue words (`bg-black text-primary border border-primary/40`). Default is `Auto`.
  - Clicking "Mode" opens a neat stacked vertical/horizontal dropdown with the 4 options: `Auto`, `⚡ Fast`, `🧠 Deep`, `🛠 Code`.
  - Selecting an option updates the active `task` state in the store/controller, directly controlling model selection and thinking depth in `sendChat(...)`.

---

### 8. Attachment Button Popup Layout & Label
- **Requirement**:
  - Match the exact blocky layout and placement of the burger tools dropdown (`grid grid-cols-4 gap-2 rounded-2xl glass p-2`).
  - Shorten the file attachment label from *"Attach Document (.pdf, .docx, .txt...)"* to **"File"**.
  - All items (`Upload`, `Photo`, `Live Eye`, `File`) display cleanly in the blocky grid style.

---

### Verification Plan
- Build and compile with `lint_applet` and test all 8 points.
- Verify textbox border at rest vs focus.
- Verify Send & Stop button colors.
- Verify Mode dropdown opens and switches mode effectively.
- Verify Attach button uses blocky grid with label "File".
- Verify auto-scroll to bottom triggers during thinking animations.
- Verify adaptive scroll button is hidden during thinking animations.
