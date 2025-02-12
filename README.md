# Scryfall MCP Server

A [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) server for interacting with the [Scryfall](https://scryfall.com/docs/api) API. It provides tools to look up Magic: The Gathering card details, card rulings, and price information.

![Scryfall MCP Server](img/sorcerer.jpg)

## Features

- **search_cards**  
  Perform a text-based search on Scryfall. Returns a list of matching cards.
- **get_card_by_id**  
  Retrieve a card directly via its Scryfall UUID.
- **get_card_by_name**  
  Retrieve a card by exact English name.
- **random_card**  
  Get a random card from the entire Scryfall database.
- **get_rulings**  
  Retrieve official rulings for a card, which may clarify card interactions or rules.
- **get_prices_by_id**  
  Retrieve current pricing information (USD, USD foil, EUR, TIX) for a given card by Scryfall ID.
- **get_prices_by_name**  
  Retrieve current pricing information (USD, USD foil, EUR, TIX) for a given card by exact name.

## Usage

The server can be run in two modes:

1. Standard stdio mode (default)
2. Server-Sent Events (SSE) mode with HTTP endpoints

### Using NPX

If you have Node.js installed locally:

```bash
# Stdio mode
npx scryfall-mcp-server

# SSE mode
npx scryfall-mcp-server --sse
```

### Connecting to the Server

#### Stdio Mode

Your application or environment (like Claude Desktop) can communicate directly via stdio with the server.

#### SSE Mode

When running in SSE mode (with `--sse`), you can connect using the MCP CLI:

```bash
npx @wong2/mcp-cli --sse http://localhost:3000/sse
```

The server will be available at:

- SSE endpoint: `http://localhost:3000/sse`
- Message endpoint: `http://localhost:3000/messages`

### Integration in claude_desktop_config.json

Example snippet for stdio mode:

```json
{
  "mcpServers": {
    "scryfall": {
      "command": "docker",
      "args": ["run", "-i", "--rm", "mcp/scryfall"]
    }
  }
}
```

Or with npx:

```json
{
  "mcpServers": {
    "scryfall": {
      "command": "npx",
      "args": ["scryfall-mcp-server"]
    }
  }
}
```

### Building from Docker

```bash
docker build -t mcp/scryfall .
```

Then you can run in stdio mode:

```bash
docker run -i --rm mcp/scryfall
```

Or in SSE mode:

```bash
docker run -i --rm -p 3000:3000 mcp/scryfall --sse
```

## License

Licensed under the MIT License.
