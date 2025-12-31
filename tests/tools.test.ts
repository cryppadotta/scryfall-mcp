import { jest } from '@jest/globals';

// Mock fetch before importing the module
jest.unstable_mockModule('node-fetch', () => ({
  default: jest.fn(),
  Response: jest.fn(),
}));

const { SCRYFALL_TOOLS } = await import('../index.js');

describe('Tool Definitions', () => {
  describe('SCRYFALL_TOOLS array', () => {
    it('should contain 13 tools', () => {
      expect(SCRYFALL_TOOLS).toHaveLength(13);
    });

    it('should have unique tool names', () => {
      const names = SCRYFALL_TOOLS.map(tool => tool.name);
      const uniqueNames = new Set(names);
      expect(uniqueNames.size).toBe(names.length);
    });
  });

  describe('Tool schema validation', () => {
    it.each(SCRYFALL_TOOLS)('$name should have valid structure', (tool) => {
      expect(tool).toHaveProperty('name');
      expect(tool).toHaveProperty('description');
      expect(tool).toHaveProperty('inputSchema');
      expect(typeof tool.name).toBe('string');
      expect(typeof tool.description).toBe('string');
      expect(tool.inputSchema).toHaveProperty('type', 'object');
      expect(tool.inputSchema).toHaveProperty('properties');
      expect(tool.inputSchema).toHaveProperty('required');
    });
  });

  describe('Card tools', () => {
    it('search_cards should require query parameter', () => {
      const tool = SCRYFALL_TOOLS.find(t => t.name === 'search_cards');
      expect(tool).toBeDefined();
      expect(tool!.inputSchema.required).toContain('query');
      expect(tool!.inputSchema.properties).toHaveProperty('query');
    });

    it('get_card_by_id should require id parameter', () => {
      const tool = SCRYFALL_TOOLS.find(t => t.name === 'get_card_by_id');
      expect(tool).toBeDefined();
      expect(tool!.inputSchema.required).toContain('id');
    });

    it('get_card_by_name should require name parameter', () => {
      const tool = SCRYFALL_TOOLS.find(t => t.name === 'get_card_by_name');
      expect(tool).toBeDefined();
      expect(tool!.inputSchema.required).toContain('name');
    });

    it('random_card should have no required parameters', () => {
      const tool = SCRYFALL_TOOLS.find(t => t.name === 'random_card');
      expect(tool).toBeDefined();
      expect(tool!.inputSchema.required).toHaveLength(0);
    });

    it('get_rulings should require id parameter', () => {
      const tool = SCRYFALL_TOOLS.find(t => t.name === 'get_rulings');
      expect(tool).toBeDefined();
      expect(tool!.inputSchema.required).toContain('id');
    });
  });

  describe('Price tools', () => {
    it('get_prices_by_id should require id parameter', () => {
      const tool = SCRYFALL_TOOLS.find(t => t.name === 'get_prices_by_id');
      expect(tool).toBeDefined();
      expect(tool!.inputSchema.required).toContain('id');
    });

    it('get_prices_by_name should require name parameter', () => {
      const tool = SCRYFALL_TOOLS.find(t => t.name === 'get_prices_by_name');
      expect(tool).toBeDefined();
      expect(tool!.inputSchema.required).toContain('name');
    });
  });

  describe('Set tools', () => {
    it('list_sets should have no required parameters', () => {
      const tool = SCRYFALL_TOOLS.find(t => t.name === 'list_sets');
      expect(tool).toBeDefined();
      expect(tool!.inputSchema.required).toHaveLength(0);
    });

    it('get_set_by_code should require code parameter', () => {
      const tool = SCRYFALL_TOOLS.find(t => t.name === 'get_set_by_code');
      expect(tool).toBeDefined();
      expect(tool!.inputSchema.required).toContain('code');
    });

    it('get_set_by_id should require id parameter', () => {
      const tool = SCRYFALL_TOOLS.find(t => t.name === 'get_set_by_id');
      expect(tool).toBeDefined();
      expect(tool!.inputSchema.required).toContain('id');
    });

    it('get_set_by_tcgplayer_id should require id parameter', () => {
      const tool = SCRYFALL_TOOLS.find(t => t.name === 'get_set_by_tcgplayer_id');
      expect(tool).toBeDefined();
      expect(tool!.inputSchema.required).toContain('id');
    });
  });

  describe('Symbology tools', () => {
    it('list_symbology should have no required parameters', () => {
      const tool = SCRYFALL_TOOLS.find(t => t.name === 'list_symbology');
      expect(tool).toBeDefined();
      expect(tool!.inputSchema.required).toHaveLength(0);
    });

    it('parse_mana_cost should require cost parameter', () => {
      const tool = SCRYFALL_TOOLS.find(t => t.name === 'parse_mana_cost');
      expect(tool).toBeDefined();
      expect(tool!.inputSchema.required).toContain('cost');
    });
  });
});
