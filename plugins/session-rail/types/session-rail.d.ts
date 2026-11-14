declare module 'claude-code' {
  interface PluginState {
    // Bumped when the prompt being read moves; the rail's sites read it while
    // drawing, so a bump draws them again, and them alone. `resume` keeps the
    // boundaries a resumed session draws: the session it belongs to, every
    // moment it was resumed at (oldest first, the latest also `at`), how many
    // prompts were sent since the latest in all, and how many of each short
    // text key (never the text itself). The engine holds it across a hot
    // reload of this module; a new process starts without it, and `/clear`
    // writes it away.
    'session-rail': {
      moved: number
      // `sessionId` is null while a resume learnt from `session.end` waits for
      // the next conversation to adopt it: during that hook the engine still
      // names the closing session, not the one the process goes on in.
      resume: { sessionId: string | null; at: number; moments: number[]; counts: boolean; total: number; since: [string, number][] } | null
    }
  }
}
