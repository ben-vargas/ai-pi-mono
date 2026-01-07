# MCP Client Extension for Pi

This extension enables Pi to connect to any MCP (Model Context Protocol) server, making their tools available to the LLM.

## Why This Extension?

Pi [deliberately chose not to include MCP support](https://mariozechner.at/posts/2025-11-02-what-if-you-dont-need-mcp/) in its core, preferring the simpler Skills approach. However, there are valid use cases for MCP:

- **Enterprise environments** where MCP servers are the standard tool distribution mechanism
- **Free hosted MCP endpoints** like Exa's `https://mcp.exa.ai/mcp` that don't require API keys
- **Existing MCP server investments** that you want to leverage

This extension provides MCP support as an **opt-in feature**, keeping Pi's core simple while enabling MCP when needed.

## Installation

1. **Copy the extension** to your Pi extensions directory:
   ```bash
   cp -r mcp-client ~/.pi/agent/extensions/
   ```

2. **Install dependencies**:
   ```bash
   cd ~/.pi/agent/extensions/mcp-client
   npm install
   ```

3. **Create your configuration**:
   ```bash
   cp mcp-servers.example.json ~/.pi/mcp-servers.json
   # Edit ~/.pi/mcp-servers.json with your server configurations
   ```

## Configuration

Create `~/.pi/mcp-servers.json` (or `.pi/mcp-servers.json` in your project):

```json
{
  "servers": [
    {
      "id": "exa",
      "name": "Exa Search",
      "type": "http",
      "url": "https://mcp.exa.ai/mcp?tools=web_search_exa,get_code_context_exa",
      "autoConnect": true
    }
  ]
}
```

### Server Configuration Options

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique identifier for the server |
| `name` | string | Human-readable name |
| `type` | "http" \| "stdio" | Transport type |
| `url` | string | For HTTP: the server URL |
| `command` | string | For stdio: command to run |
| `args` | string[] | For stdio: command arguments |
| `env` | object | For stdio: environment variables |
| `tools` | string[] | Optional: only register these tools |
| `autoConnect` | boolean | Connect automatically on startup |
| `headers` | object | Optional: HTTP headers |

### Transport Types

**HTTP Transport** - For remote MCP servers:
```json
{
  "id": "exa",
  "type": "http",
  "url": "https://mcp.exa.ai/mcp"
}
```

**Stdio Transport** - For local subprocess servers:
```json
{
  "id": "exa-local",
  "type": "stdio",
  "command": "npx",
  "args": ["-y", "exa-mcp-server"],
  "env": {
    "EXA_API_KEY": "your-key"
  }
}
```

## Usage

### Commands

| Command | Description |
|---------|-------------|
| `/mcp status` | Show connected servers |
| `/mcp list` | List configured servers |
| `/mcp connect [id]` | Connect to a server |
| `/mcp disconnect [id]` | Disconnect from a server |
| `/mcp tools` | List available MCP tools |

### Example: Using Exa Search

1. Configure Exa in `~/.pi/mcp-servers.json`:
   ```json
   {
     "servers": [
       {
         "id": "exa",
         "name": "Exa Search",
         "type": "http",
         "url": "https://mcp.exa.ai/mcp?tools=web_search_exa,get_code_context_exa",
         "autoConnect": true
       }
     ]
   }
   ```

2. Start Pi - Exa will auto-connect

3. Ask the LLM to search:
   ```
   Search for the latest React 19 features
   ```

The LLM will use the `mcp_exa_web_search_exa` tool automatically.

## Tool Naming

MCP tools are registered with the prefix `mcp_{serverId}_{toolName}` to avoid collisions:

- `web_search_exa` from server `exa` → `mcp_exa_web_search_exa`
- `get_code_context_exa` from server `exa` → `mcp_exa_get_code_context_exa`

## Minimizing Context Overhead

One concern with MCP is that tool definitions consume context tokens. To minimize this:

1. **Use the `tools` filter** in your config to only register tools you need:
   ```json
   {
     "url": "https://mcp.exa.ai/mcp",
     "tools": ["web_search_exa", "get_code_context_exa"]
   }
   ```

2. **Use URL parameters** for servers that support them:
   ```
   https://mcp.exa.ai/mcp?tools=web_search_exa
   ```

3. **Don't auto-connect** servers you rarely use - connect them on-demand with `/mcp connect`

## Supported MCP Servers

This extension works with any MCP-compliant server. Some popular ones:

- **Exa Search** - Web and code search (`https://mcp.exa.ai/mcp`)
- **Filesystem** - File operations (`@modelcontextprotocol/server-filesystem`)
- **GitHub** - Repository operations (`@modelcontextprotocol/server-github`)
- **Postgres** - Database queries (`@modelcontextprotocol/server-postgres`)
- **Puppeteer** - Browser automation (`@modelcontextprotocol/server-puppeteer`)

See the [MCP Servers Repository](https://github.com/modelcontextprotocol/servers) for more.

## Troubleshooting

### Connection Errors

- **HTTP servers**: Check the URL is correct and accessible
- **Stdio servers**: Ensure the command is installed (`npx -y` auto-installs)
- Check Pi's console output for detailed error messages

### Tools Not Appearing

1. Verify connection: `/mcp status`
2. List available tools: `/mcp tools`
3. Check if the tool is filtered by your `tools` config

### Performance Issues

- MCP calls add network latency - consider local stdio servers for frequently-used tools
- Large tool outputs should be truncated by the MCP server

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                    Pi Agent                          │
│  ┌───────────────────────────────────────────────┐  │
│  │            MCP Client Extension                │  │
│  │  ┌─────────┐  ┌─────────┐  ┌──────────────┐  │  │
│  │  │ Manager │  │ Schema  │  │ Tool         │  │  │
│  │  │         │  │ Convert │  │ Registration │  │  │
│  │  └────┬────┘  └─────────┘  └──────────────┘  │  │
│  │       │                                        │  │
│  │  ┌────┴────────────────────────────────────┐  │  │
│  │  │           Transport Layer                │  │  │
│  │  │  ┌──────────┐      ┌───────────────┐    │  │  │
│  │  │  │   HTTP   │      │     Stdio     │    │  │  │
│  │  │  │ (SSE)    │      │ (subprocess)  │    │  │  │
│  │  │  └────┬─────┘      └───────┬───────┘    │  │  │
│  │  └───────┼────────────────────┼────────────┘  │  │
│  └──────────┼────────────────────┼────────────────┘  │
└─────────────┼────────────────────┼────────────────────┘
              │                    │
              ▼                    ▼
       ┌──────────────┐    ┌──────────────┐
       │  Remote MCP  │    │  Local MCP   │
       │   Server     │    │   Server     │
       │ (exa.ai/mcp) │    │ (npx ...)    │
       └──────────────┘    └──────────────┘
```

## License

MIT - Same as Pi
