# Scryfall MCP Server

A [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) server for interacting with the [Scryfall](https://scryfall.com/docs/api) API. It provides tools to look up Magic: The Gathering card details, card rulings, and price information.

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

- **get_prices**  
  Retrieve current pricing information (USD, USD foil, EUR, TIX) for a given card by name or ID.

## Usage

### Building from Docker

```bash
docker build -t mcp/scryfall .
```

Then you can run:

```bash
docker run -i --rm mcp/scryfall
```

Your application or environment (like Claude Desktop) can communicate via stdio with the server.

### Using NPX

If you have Node.js installed locally:

```bash
cd /path/to/this/repo
npx -y @modelcontextprotocol/server-scryfall
```

This will start the MCP server on stdio.

### Integration in claude_desktop_config.json

Example snippet:

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
      "args": ["-y", "@modelcontextprotocol/server-scryfall"]
    }
  }
}
```

## License

Licensed under the MIT License.
