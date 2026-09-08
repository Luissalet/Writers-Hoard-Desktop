# Claude and Codex subscriptions

Open **AI settings → Use my subscriptions** in the desktop app.

1. Install the official [Claude Code](https://code.claude.com/docs/en/setup) or
   [Codex](https://developers.openai.com/codex/cli) client. Restart Writers Hoard
   after installation if the client cannot be found.
2. Choose **Sign in** to launch the official login flow, or **Import existing
   session** if the client is already signed in with your subscription.
   On systems without the login launcher, run `claude auth login` or `codex login`
   in your terminal, then return to the app.
3. Choose **Save and check**. This checks authentication without generating text.
   An API-key login is not accepted as a subscription login.
4. Choose **Use by default**, or select the connection under default text models.
   The client default follows the official client's model choice. Optional model
   IDs are user-supplied; saving one does not prove your account can access it.

Requests consume your subscription allowance. Writers Hoard does not import,
display or copy provider credentials. It uses the official client's stored login,
removes inherited API-key/provider redirects from the child environment and
requires subscription authentication. A quota or login failure stops the request;
it never silently retries through a billable API connection.

Text editing, analysis and the copilot can use these connections. Native client
tools are disabled. The copilot supplies its allowed application tools in a
structured text protocol, validates the complete response, then passes proposals
to the existing application executor for scope, permissions, confirmation,
history and undo. Invalid responses are rejected. This is not a separate agent
with direct access to project files.

Replies appear when the official client finishes. Image generation and image
attachments are not supported by these text connections. Keep using the existing
image providers for those features. Removing a connection does not sign out the
official client or delete its login.

Codex must support the app-server fields used to disable execution environments.
The app checks its generated protocol schema and rejects older clients that do
not support this isolation. Update the official client if instructed.

The reverse direction—operating Writers Hoard from another assistant—is covered
in [external assistant setup](ai-external-connection.md).

## Implementation and verification

- `electron/ai/subscriptionClient.ts`: official-client authentication, process
  supervision and text transport. Codex uses app-server; Claude uses print mode.
- `electron/ai/adapters/subscription.ts`: common inference gateway adapter.
- `src/services/aiRuntime/subscriptionProtocol.ts`: tool proposal protocol.
- `src/components/ai-settings/SubscriptionsSection.tsx`: connection controls.
- `node scripts/run-subscription-protocol-tests.mjs`: offline protocol tests.
- `node scripts/run-subscription-backend-tests.mjs`: offline authentication,
  process cancellation and login-launcher tests.
- `npx electron scripts/run-ai-settings-ui.cjs`: isolated interactive controls
  and screenshots at desktop and compact window sizes.
- `node scripts/test-subscription-live.mjs`: explicit live smoke test using your
  existing subscriptions. Consumes a small amount of allowance; checks a tool
  proposal and a follow-up with a synthetic result, without accessing project data.

Official reference: [Codex authentication](https://developers.openai.com/codex/auth)
and [app-server](https://developers.openai.com/codex/app-server).
