# SECRET-HANDLING RULES

The following files and values are private and must never be inspected, opened, printed, searched, copied, summarized, or included in responses:

* `.env`
* `.env.local`
* `.env.*.local`
* Any file containing API keys, tokens, passwords, private keys, or credentials
* Any secret-management configuration containing real credentials

## Required behavior

1. NEVER read the contents of `.env.local` or other secret files.
2. NEVER run commands such as:

   * `cat .env.local`
   * `type .env.local`
   * `Get-Content .env.local`
   * `grep` or `findstr` against secret files
   * Any command that prints environment secrets
3. NEVER expose secret values in:

   * chat responses
   * generated source code
   * logs
   * screenshots
   * terminal output
   * commit messages
4. When an API key or credential is required, reference the environment variable by its name only.
5. Use placeholder values when creating examples, such as:
   `TELEGRAM_BOT_TOKEN=<server-side-secret>`
6. Do not attempt to discover the actual value of any secret.
7. If implementation requires access to a secret value, stop using the secret directly and implement the integration so the application reads it at runtime.
8. Never place private API keys directly into React components or client-side source files.

## Secret-safe development

Use `.env.example` or `.env.local.example` containing only placeholder values.

Example:

TELEGRAM_BOT_TOKEN=your_telegram_bot_token_here
TELEGRAM_FACULTY_CHAT_ID=your_faculty_chat_id_here
TELEGRAM_MAYORS_CHAT_ID=your_mayors_chat_id_here

The real values must remain outside source control and must not be inspected by the coding agent.
