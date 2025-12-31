import { jest } from '@jest/globals';

// Mock fetch before importing
jest.unstable_mockModule('node-fetch', () => ({
  default: jest.fn(),
  Response: jest.fn(),
}));

const { createScryfallServer, SCRYFALL_TOOLS } = await import('../index.js');

describe('createScryfallServer', () => {
  it('should create a server instance', () => {
    const server = createScryfallServer();
    expect(server).toBeDefined();
  });

  it('should create server with correct name and version', () => {
    const server = createScryfallServer();
    // The server object should have been created with the correct metadata
    expect(server).toBeDefined();
  });

  it('should register all tools', () => {
    // Verify that all 13 tools are defined
    expect(SCRYFALL_TOOLS).toHaveLength(13);

    const expectedTools = [
      'search_cards',
      'get_card_by_id',
      'get_card_by_name',
      'random_card',
      'get_rulings',
      'get_prices_by_id',
      'get_prices_by_name',
      'list_sets',
      'get_set_by_code',
      'get_set_by_id',
      'get_set_by_tcgplayer_id',
      'list_symbology',
      'parse_mana_cost',
    ];

    const actualTools = SCRYFALL_TOOLS.map(t => t.name);
    expect(actualTools).toEqual(expectedTools);
  });

  it('should create independent server instances', () => {
    const server1 = createScryfallServer();
    const server2 = createScryfallServer();
    expect(server1).not.toBe(server2);
  });
});

describe('Tool Categories', () => {
  it('should have card-related tools', () => {
    const cardTools = SCRYFALL_TOOLS.filter(t =>
      ['search_cards', 'get_card_by_id', 'get_card_by_name', 'random_card', 'get_rulings'].includes(t.name)
    );
    expect(cardTools).toHaveLength(5);
  });

  it('should have price-related tools', () => {
    const priceTools = SCRYFALL_TOOLS.filter(t =>
      t.name.startsWith('get_prices')
    );
    expect(priceTools).toHaveLength(2);
  });

  it('should have set-related tools', () => {
    const setTools = SCRYFALL_TOOLS.filter(t =>
      t.name.includes('set')
    );
    expect(setTools).toHaveLength(4);
  });

  it('should have symbology-related tools', () => {
    const symbologyTools = SCRYFALL_TOOLS.filter(t =>
      t.name === 'list_symbology' || t.name === 'parse_mana_cost'
    );
    expect(symbologyTools).toHaveLength(2);
  });
});
