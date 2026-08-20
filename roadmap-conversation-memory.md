# Conversation memory audit: root cause and fix

## What we found

The agent was effectively seeing only the last 10 messages of the conversation, regardless of actual dialogue length. This was caused by a combination of three bugs:

1. `SUMMARY_TOKEN_THRESHOLD` was set to `Infinity`, so the summarization gate never triggered in real life.
2. Token counting used `recentMessages` (the last 10 messages) instead of the full `formattedMessages` history, so the threshold check was measuring the wrong thing.
3. In the early-return branch (`if (totalTokens <= SUMMARY_TOKEN_THRESHOLD)`), the function returned `recentMessages` instead of the full history, even when no compression was needed.

This meant the system silently forgot the earlier part of a conversation even when the total history fit inside the token budget.

## What we fixed

- Raised the load limit from 30 to 120 messages in `loadConversationMessages`.
- Kept a compact tail for summarization: `SUMMARY_TAIL_MESSAGES` is now 25.
- Replaced the dead threshold `Infinity` with a real budget: `8000` tokens.
- Used the full `formattedMessages` history for token estimation instead of the last 10 only.
- When the total history fit under the threshold, we now return the full history instead of truncating to the last 10 messages.

## Why 8000 is a reasonable threshold

We observed that system prompts for agents like Айгерим/Самат are around 12–13k characters. A conservative conversion from characters to tokens is roughly 1 token per 2.5–3 characters in Russian text, which gives a rough range of around 4k–5k tokens for the prompt alone.

Keeping an additional budget for RAG context, current history, and completion output means a threshold around 8k tokens is still conservative enough to avoid hitting the model budget, while allowing the agent to actually remember the conversation instead of dropping earlier context silently.

This is a deliberate trade-off: longer latency is expected when the agent keeps more of the conversation in context, but it is the correct behavior compared to the previous silent truncation.

## Expected operational trade-off

This fix increases prompt size when the dialogue is longer, so latency may rise over the next day or two in real sessions. That is expected and is the direct cost of making the agent retain the visible conversation instead of discarding earlier turns.

This is not a bug; it is the correct consequence of the fix.
