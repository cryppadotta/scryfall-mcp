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
import { parse, fileURLToPath } from "node:url";

/**
 * Scryfall API references:
 *  - https://api.scryfall.com
 *  - https://scryfall.com/docs/api
 *
 * The server below exposes several tools:
 * 1) search_cards           - Perform a text query and list matching cards
 * 2) get_card_by_id         - Get a card by Scryfall ID (UUID)
 * 3) get_card_by_name       - Get a card by exact name
 * 4) random_card            - Get a random card
 * 5) get_rulings            - Retrieve rulings (official text on card interactions) by card ID
 * 6) get_prices_by_id       - Get card prices for a specified card ID
 * 7) get_prices_by_name     - Get card prices for a specified card name
 * 8) list_sets              - List all MTG sets
 * 9) get_set_by_code        - Get a set by its 3-6 letter code (e.g., 'aer', 'dom')
 * 10) get_set_by_id         - Get a set by Scryfall UUID
 * 11) get_set_by_tcgplayer_id - Get a set by TCGplayer group ID
 * 12) list_symbology        - List all card symbols (mana symbols, tap, etc.)
 * 13) parse_mana_cost       - Parse a mana cost string and get CMC, colors, etc.
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

// Scryfall Set object
interface ScryfallSet {
  object: "set";
  id: string;
  code: string;
  name: string;
  set_type: string;
  released_at?: string;
  block_code?: string;
  block?: string;
  parent_set_code?: string;
  card_count: number;
  printed_size?: number;
  digital: boolean;
  foil_only: boolean;
  nonfoil_only: boolean;
  scryfall_uri: string;
  uri: string;
  icon_svg_uri: string;
  search_uri: string;
}

// Scryfall Card Symbol object
interface ScryfallCardSymbol {
  object: "card_symbol";
  symbol: string;
  loose_variant?: string;
  english: string;
  transposable: boolean;
  represents_mana: boolean;
  mana_value?: number;
  appears_in_mana_costs: boolean;
  funny: boolean;
  colors: string[];
  hybrid: boolean;
  phyrexian: boolean;
  gatherer_alternates?: string[];
  svg_uri: string;
}

// Scryfall Mana Cost object (response from parse-mana)
interface ScryfallManaCost {
  object: "mana_cost";
  cost: string;
  cmc: number;
  colors: string[];
  colorless: boolean;
  monocolored: boolean;
  multicolored: boolean;
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

// Sets tools
const LIST_SETS_TOOL: Tool = {
  name: "list_sets",
  description:
    "Retrieve a list of all Magic: The Gathering sets from Scryfall. " +
    "Returns an array of set objects with fields like code, name, set_type, released_at, card_count, etc.",
  inputSchema: {
    type: "object",
    properties: {},
    required: []
  }
};

const GET_SET_BY_CODE_TOOL: Tool = {
  name: "get_set_by_code",
  description:
    "Retrieve a set by its unique 3-6 letter code (e.g., 'aer' for Aether Revolt, 'dom' for Dominaria). " +
    "Returns the set object with details like name, release date, card count, and set type.",
  inputSchema: {
    type: "object",
    properties: {
      code: {
        type: "string",
        description: "The unique set code, e.g. 'aer', 'dom', 'khm'"
      }
    },
    required: ["code"]
  }
};

const GET_SET_BY_ID_TOOL: Tool = {
  name: "get_set_by_id",
  description:
    "Retrieve a set by its Scryfall UUID. Returns the set object with details like name, code, release date, and card count.",
  inputSchema: {
    type: "object",
    properties: {
      id: {
        type: "string",
        description: "The Scryfall UUID of the set"
      }
    },
    required: ["id"]
  }
};

const GET_SET_BY_TCGPLAYER_ID_TOOL: Tool = {
  name: "get_set_by_tcgplayer_id",
  description:
    "Retrieve a set by its TCGplayer group ID. Useful for cross-referencing with TCGplayer's database.",
  inputSchema: {
    type: "object",
    properties: {
      id: {
        type: "string",
        description: "The TCGplayer group ID for the set"
      }
    },
    required: ["id"]
  }
};

// Symbology tools
const LIST_SYMBOLOGY_TOOL: Tool = {
  name: "list_symbology",
  description:
    "Retrieve all card symbols available in Scryfall's database. " +
    "Returns an array of symbol objects with properties like symbol text, English description, " +
    "whether it represents mana, mana value, colors, and SVG URI for the symbol image.",
  inputSchema: {
    type: "object",
    properties: {},
    required: []
  }
};

const PARSE_MANA_COST_TOOL: Tool = {
  name: "parse_mana_cost",
  description:
    "Parse a mana cost string and get information about it. " +
    "Accepts a mana cost notation string (e.g., '{2}{W}{U}', 'RUG', '2WW') and returns " +
    "the normalized cost, converted mana cost (cmc), colors, and whether it's colorless/mono/multicolored.",
  inputSchema: {
    type: "object",
    properties: {
      cost: {
        type: "string",
        description: "The mana cost to parse, e.g. '{2}{W}{U}', 'RUG', '2WW'"
      }
    },
    required: ["cost"]
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
  GET_PRICES_BY_NAME_TOOL,
  LIST_SETS_TOOL,
  GET_SET_BY_CODE_TOOL,
  GET_SET_BY_ID_TOOL,
  GET_SET_BY_TCGPLAYER_ID_TOOL,
  LIST_SYMBOLOGY_TOOL,
  PARSE_MANA_COST_TOOL
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

// Sets handlers
async function handleListSets() {
  const url = "https://api.scryfall.com/sets";
  const response = await fetch(url);
  return handleScryfallResponse(response);
}

async function handleGetSetByCode(code: string) {
  const url = `https://api.scryfall.com/sets/${encodeURIComponent(code)}`;
  const response = await fetch(url);
  return handleScryfallResponse(response);
}

async function handleGetSetById(id: string) {
  const url = `https://api.scryfall.com/sets/${encodeURIComponent(id)}`;
  const response = await fetch(url);
  return handleScryfallResponse(response);
}

async function handleGetSetByTcgplayerId(id: string) {
  const url = `https://api.scryfall.com/sets/tcgplayer/${encodeURIComponent(id)}`;
  const response = await fetch(url);
  return handleScryfallResponse(response);
}

// Symbology handlers
async function handleListSymbology() {
  const url = "https://api.scryfall.com/symbology";
  const response = await fetch(url);
  return handleScryfallResponse(response);
}

async function handleParseManaCost(cost: string) {
  const url = `https://api.scryfall.com/symbology/parse-mana?cost=${encodeURIComponent(cost)}`;
  const response = await fetch(url);
  return handleScryfallResponse(response);
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
        case "list_sets": {
          return await handleListSets();
        }
        case "get_set_by_code": {
          const { code } = args as { code: string };
          return await handleGetSetByCode(code);
        }
        case "get_set_by_id": {
          const { id } = args as { id: string };
          return await handleGetSetById(id);
        }
        case "get_set_by_tcgplayer_id": {
          const { id } = args as { id: string };
          return await handleGetSetByTcgplayerId(id);
        }
        case "list_symbology": {
          return await handleListSymbology();
        }
        case "parse_mana_cost": {
          const { cost } = args as { cost: string };
          return await handleParseManaCost(cost);
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
      async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
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

          // Return here - the response will be kept open for SSE
          return;
        } else if (req.method === "POST" && url.pathname === "/messages") {
          // Client sending an MCP message over POST
          const sessionId = url.query.sessionId as string;
          const record = transportsBySession.get(sessionId);

          if (!record) {
            res.writeHead(404, "Unknown session");
            res.end();
            return;
          }

          // Forward the POST body to this session's transport
          await record.transport.handlePostMessage(req, res);
          return;
        } else {
          res.writeHead(404, "Not Found");
          res.end();
          return;
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

// Only run the server if this file is executed directly (not imported)
const isMainModule = process.argv[1] === fileURLToPath(import.meta.url);
if (isMainModule) {
  runServer().catch((error) => {
    console.error("Fatal error running Scryfall server:", error);
    process.exit(1);
  });
}

// Exports for testing
export {
  SCRYFALL_TOOLS,
  handleScryfallResponse,
  handleSearchCards,
  handleGetCardById,
  handleGetCardByName,
  handleRandomCard,
  handleGetRulings,
  handleGetPricesById,
  handleGetPricesByName,
  handleListSets,
  handleGetSetByCode,
  handleGetSetById,
  handleGetSetByTcgplayerId,
  handleListSymbology,
  handleParseManaCost,
  createScryfallServer
};
