#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool
} from "@modelcontextprotocol/sdk/types.js";
import fetch, { Response } from "node-fetch";
import express from "express";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { parse } from "node:url";

/**
 * Scryfall API references:
 *  - https://api.scryfall.com
 *  - https://scryfall.com/docs/api
 *
 * The server below exposes several tools:
 * 1) search_cards        - Perform a text query and list matching cards
 * 2) get_card_by_id      - Get a card by Scryfall ID (UUID)
 * 3) get_card_by_name    - Get a card by exact name
 * 4) random_card         - Get a random card
 * 5) get_rulings         - Retrieve rulings (official text on card interactions) by card ID
 * 6) get_prices          - Get card prices for a specified card ID or exact name
 *
 * Each tool returns data in JSON format as a single text field.
 */

interface ScryfallError {
  object: string; // "error"
  code: string; // "not_found", etc.
  status: number; // HTTP status code
  details: string; // Description
  type?: string; // "ambiguous", etc.
  warnings?: string[];
}

// Scryfall Card object (abbreviated shape)
interface ScryfallCard {
  object: "card";
  id: string; // Scryfall ID
  name: string;
  mana_cost: string;
  type_line: string;
  oracle_text: string;
  set: string;
  set_name: string;
  collector_number: string;
  // More fields omitted; see https://scryfall.com/docs/api/cards
  prices: {
    usd?: string | null;
    usd_foil?: string | null;
    eur?: string | null;
    tix?: string | null;
  };
}

// Scryfall Ruling object
interface ScryfallRuling {
  object: "ruling";
  source: string;
  published_at: string;
  comment: string;
}

// Tools definitions
const SEARCH_CARDS_TOOL: Tool = {
  name: "search_cards",
  description:
    "Search for MTG cards by a text query, e.g. 'oracle text includes: draw cards'. " +
    "Returns a list of matching cards (with basic fields: name, set, collector_number, ID). " +
    "If no matches are found, returns an error message from Scryfall.",
  inputSchema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "A full text query, e.g. 't:goblin pow=2 o:haste'"
      }
    },
    required: ["query"]
  }
};

const GET_CARD_BY_ID_TOOL: Tool = {
  name: "get_card_by_id",
  description:
    "Retrieve a card by its Scryfall ID (a 36-char UUID). Returns the card data in JSON.",
  inputSchema: {
    type: "object",
    properties: {
      id: {
        type: "string",
        description:
          "The Scryfall UUID, e.g. 'c09c71fb-7acb-4ffb-a47b-8961a0cf4990'"
      }
    },
    required: ["id"]
  }
};

const GET_CARD_BY_NAME_TOOL: Tool = {
  name: "get_card_by_name",
  description:
    "Retrieve a card by its exact English name, e.g. 'Black Lotus'. Returns the card data in JSON. " +
    "If multiple cards share that exact name, Scryfall returns one (usually the most relevant printing).",
  inputSchema: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description: "Exact name of the card, e.g. 'Lightning Bolt'"
      }
    },
    required: ["name"]
  }
};

const RANDOM_CARD_TOOL: Tool = {
  name: "random_card",
  description:
    "Retrieve a random Magic card from Scryfall. Returns JSON data for that random card.",
  inputSchema: {
    type: "object",
    properties: {},
    required: []
  }
};

const GET_RULINGS_TOOL: Tool = {
  name: "get_rulings",
  description:
    "Retrieve official rulings for a specified card by Scryfall ID or Oracle ID. " +
    "Returns an array of rulings. Each ruling has a 'published_at' date and a 'comment' field.",
  inputSchema: {
    type: "object",
    properties: {
      id: {
        type: "string",
        description:
          "A Scryfall ID or Oracle ID. Example: 'c09c71fb-7acb-4ffb-a47b-8961a0cf4990'"
      }
    },
    required: ["id"]
  }
};

const GET_PRICES_BY_ID_TOOL: Tool = {
  name: "get_prices_by_id",
  description:
    "Retrieve price information for a card by its Scryfall ID. Returns JSON with usd, usd_foil, eur, tix, etc.",
  inputSchema: {
    type: "object",
    properties: {
      id: {
        type: "string",
        description: "Scryfall ID of the card"
      }
    },
    required: ["id"]
  }
};

const GET_PRICES_BY_NAME_TOOL: Tool = {
  name: "get_prices_by_name",
  description:
    "Retrieve price information for a card by its exact name. Returns JSON with usd, usd_foil, eur, tix, etc.",
  inputSchema: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description: "Exact card name"
      }
    },
    required: ["name"]
  }
};

// Return our set of tools
const SCRYFALL_TOOLS = [
  SEARCH_CARDS_TOOL,
  GET_CARD_BY_ID_TOOL,
  GET_CARD_BY_NAME_TOOL,
  RANDOM_CARD_TOOL,
  GET_RULINGS_TOOL,
  GET_PRICES_BY_ID_TOOL,
  GET_PRICES_BY_NAME_TOOL
] as const;

// Helper to handle Scryfall responses
async function handleScryfallResponse(response: Response) {
  if (!response.ok) {
    // Attempt to parse Scryfall error
    let errorObj: ScryfallError | null = null;
    try {
      errorObj = (await response.json()) as ScryfallError;
    } catch {
      // fall back to generic
    }
    if (errorObj && errorObj.object === "error") {
      return {
        content: [
          {
            type: "text",
            text: `Scryfall error: ${errorObj.details} (code=${errorObj.code}, status=${errorObj.status})`
          }
        ],
        isError: true
      };
    } else {
      return {
        content: [
          {
            type: "text",
            text: `HTTP error ${response.status}: ${response.statusText}`
          }
        ],
        isError: true
      };
    }
  }
  // If okay, parse JSON
  const data = await response.json();
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(data, null, 2)
      }
    ],
    isError: false
  };
}

// Actual call handlers
async function handleSearchCards(query: string) {
  const url = `https://api.scryfall.com/cards/search?q=${encodeURIComponent(
    query
  )}`;
  const response = await fetch(url);
  return handleScryfallResponse(response);
}

async function handleGetCardById(id: string) {
  const url = `https://api.scryfall.com/cards/${encodeURIComponent(id)}`;
  const response = await fetch(url);
  return handleScryfallResponse(response);
}

async function handleGetCardByName(name: string) {
  // Tilde in URL means 'exact' mode for the card name
  const url = `https://api.scryfall.com/cards/named?exact=${encodeURIComponent(
    name
  )}`;
  const response = await fetch(url);
  return handleScryfallResponse(response);
}

async function handleRandomCard() {
  const url = "https://api.scryfall.com/cards/random";
  const response = await fetch(url);
  return handleScryfallResponse(response);
}

async function handleGetRulings(id: string) {
  // Scryfall docs: /cards/{id}/rulings
  // Also works with /cards/{oracle_id}/rulings
  const url = `https://api.scryfall.com/cards/${encodeURIComponent(
    id
  )}/rulings`;
  const response = await fetch(url);
  return handleScryfallResponse(response);
}

async function handleGetPricesById(id: string) {
  const url = `https://api.scryfall.com/cards/${encodeURIComponent(id)}`;
  const response = await fetch(url);
  if (!response.ok) {
    return handleScryfallResponse(response);
  }
  const data = (await response.json()) as ScryfallCard;

  if (!data.prices) {
    return {
      content: [
        {
          type: "text",
          text: "No price information found for this card."
        }
      ],
      isError: false
    };
  }

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(data.prices, null, 2)
      }
    ],
    isError: false
  };
}

async function handleGetPricesByName(name: string) {
  const url = `https://api.scryfall.com/cards/named?exact=${encodeURIComponent(
    name
  )}`;
  const response = await fetch(url);
  if (!response.ok) {
    return handleScryfallResponse(response);
  }
  const data = (await response.json()) as ScryfallCard;

  if (!data.prices) {
    return {
      content: [
        {
          type: "text",
          text: "No price information found for this card."
        }
      ],
      isError: false
    };
  }

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(data.prices, null, 2)
      }
    ],
    isError: false
  };
}

// A map of sessionId -> { transport, server } for SSE connections
const transportsBySession = new Map<
  string,
  { transport: SSEServerTransport; server: Server }
>();

// Create a new server instance with all our handlers
function createScryfallServer() {
  const newServer = new Server(
    {
      name: "mcp-server/scryfall",
      version: "0.1.0"
    },
    {
      capabilities: {
        tools: {}
      }
    }
  );

  // Set up our request handlers
  newServer.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: SCRYFALL_TOOLS
  }));

  newServer.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
      const { name, arguments: args } = request.params;
      switch (name) {
        case "search_cards": {
          const { query } = args as { query: string };
          return await handleSearchCards(query);
        }
        case "get_card_by_id": {
          const { id } = args as { id: string };
          return await handleGetCardById(id);
        }
        case "get_card_by_name": {
          const { name } = args as { name: string };
          return await handleGetCardByName(name);
        }
        case "random_card": {
          return await handleRandomCard();
        }
        case "get_rulings": {
          const { id } = args as { id: string };
          return await handleGetRulings(id);
        }
        case "get_prices_by_id": {
          const { id } = args as { id: string };
          return await handleGetPricesById(id);
        }
        case "get_prices_by_name": {
          const { name } = args as { name: string };
          return await handleGetPricesByName(name);
        }
        default:
          return {
            content: [
              {
                type: "text",
                text: `Error: Unknown tool name "${name}"`
              }
            ],
            isError: true
          };
      }
    } catch (err) {
      return {
        content: [
          {
            type: "text",
            text: `Error: ${(err as Error).message}`
          }
        ],
        isError: true
      };
    }
  });

  return newServer;
}

// Start the server with either stdio or SSE transport
async function runServer() {
  const argv = await yargs(hideBin(process.argv))
    .option("sse", {
      type: "boolean",
      description: "Use SSE transport instead of stdio",
      default: false
    })
    .option("port", {
      type: "number",
      description: "Port to use for SSE transport",
      default: 3000
    })
    .help().argv;

  if (argv.sse) {
    const httpServer = createServer(
      async (req: IncomingMessage, res: ServerResponse) => {
        const url = parse(req.url ?? "", true);

        if (req.method === "GET" && url.pathname === "/sse") {
          // Client establishing SSE connection
          const transport = new SSEServerTransport("/messages", res);
          const scryfallServer = createScryfallServer();

          // Store them in our map for routing POSTs
          transportsBySession.set(transport.sessionId, {
            transport,
            server: scryfallServer
          });

          // Set SSE headers
          res.setHeader("Content-Type", "text/event-stream");
          res.setHeader("Cache-Control", "no-cache");
          res.setHeader("Connection", "keep-alive");

          // Connect transport to server
          scryfallServer.connect(transport).catch((err) => {
            console.error("Error attaching SSE transport:", err);
            res.end();
          });

          console.error(
            `New SSE connection established (session: ${transport.sessionId})`
          );
        } else if (req.method === "POST" && url.pathname === "/messages") {
          // Client sending an MCP message over POST
          const sessionId = url.query.sessionId as string;
          const record = transportsBySession.get(sessionId);

          if (!record) {
            res.writeHead(404, "Unknown session");
            return res.end();
          }

          // Forward the POST body to this session's transport
          await record.transport.handlePostMessage(req, res);
        } else {
          res.writeHead(404, "Not Found");
          res.end();
        }
      }
    );

    httpServer.listen(argv.port, () => {
      console.error(
        `Scryfall MCP Server listening on http://localhost:${argv.port}`
      );
    });
  } else {
    // Standard stdio mode
    const server = createScryfallServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("Scryfall MCP Server running on stdio");
  }
}

runServer().catch((error) => {
  console.error("Fatal error running Scryfall server:", error);
  process.exit(1);
});
