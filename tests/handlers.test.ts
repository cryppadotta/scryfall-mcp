import { jest } from '@jest/globals';

// Create mock fetch function with proper typing
const mockFetch = jest.fn<() => Promise<{
  ok: boolean;
  status: number;
  statusText: string;
  json: () => Promise<unknown>;
}>>();

// Mock node-fetch before importing the module
jest.unstable_mockModule('node-fetch', () => ({
  default: mockFetch,
  Response: class MockResponse {
    ok: boolean;
    status: number;
    statusText: string;
    private body: unknown;

    constructor(body: unknown, init?: { status?: number; statusText?: string }) {
      this.body = body;
      this.ok = (init?.status ?? 200) >= 200 && (init?.status ?? 200) < 300;
      this.status = init?.status ?? 200;
      this.statusText = init?.statusText ?? 'OK';
    }

    async json() {
      return this.body;
    }
  },
}));

// Import after mocking
const {
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
} = await import('../index.js');

// Helper to create mock response
function createMockResponse(data: unknown, ok = true, status = 200, statusText = 'OK') {
  return {
    ok,
    status,
    statusText,
    json: async () => data,
  };
}

describe('Handler Functions', () => {
  beforeEach(() => {
    mockFetch.mockClear();
  });

  describe('handleSearchCards', () => {
    it('should call correct API endpoint with encoded query', async () => {
      const mockData = { object: 'list', data: [{ name: 'Lightning Bolt' }] };
      mockFetch.mockResolvedValueOnce(createMockResponse(mockData));

      const result = await handleSearchCards('t:instant');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.scryfall.com/cards/search?q=t%3Ainstant'
      );
      expect(result.isError).toBe(false);
      expect(result.content[0].type).toBe('text');
    });

    it('should handle special characters in query', async () => {
      const mockData = { object: 'list', data: [] };
      mockFetch.mockResolvedValueOnce(createMockResponse(mockData));

      await handleSearchCards('o:"draw a card"');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('o%3A%22draw%20a%20card%22')
      );
    });

    it('should handle API errors', async () => {
      const errorData = {
        object: 'error',
        code: 'not_found',
        status: 404,
        details: 'No cards found',
      };
      mockFetch.mockResolvedValueOnce(createMockResponse(errorData, false, 404, 'Not Found'));

      const result = await handleSearchCards('nonexistent');

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Scryfall error');
    });
  });

  describe('handleGetCardById', () => {
    it('should call correct API endpoint with card ID', async () => {
      const mockCard = { object: 'card', id: 'abc123', name: 'Black Lotus' };
      mockFetch.mockResolvedValueOnce(createMockResponse(mockCard));

      const result = await handleGetCardById('abc123');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.scryfall.com/cards/abc123'
      );
      expect(result.isError).toBe(false);
    });

    it('should handle card not found', async () => {
      const errorData = {
        object: 'error',
        code: 'not_found',
        status: 404,
        details: 'Card not found',
      };
      mockFetch.mockResolvedValueOnce(createMockResponse(errorData, false, 404));

      const result = await handleGetCardById('invalid-id');

      expect(result.isError).toBe(true);
    });
  });

  describe('handleGetCardByName', () => {
    it('should call correct API endpoint with exact name', async () => {
      const mockCard = { object: 'card', name: 'Lightning Bolt' };
      mockFetch.mockResolvedValueOnce(createMockResponse(mockCard));

      const result = await handleGetCardByName('Lightning Bolt');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.scryfall.com/cards/named?exact=Lightning%20Bolt'
      );
      expect(result.isError).toBe(false);
    });
  });

  describe('handleRandomCard', () => {
    it('should call random card endpoint', async () => {
      const mockCard = { object: 'card', name: 'Some Random Card' };
      mockFetch.mockResolvedValueOnce(createMockResponse(mockCard));

      const result = await handleRandomCard();

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.scryfall.com/cards/random'
      );
      expect(result.isError).toBe(false);
    });
  });

  describe('handleGetRulings', () => {
    it('should call rulings endpoint with card ID', async () => {
      const mockRulings = {
        object: 'list',
        data: [{ object: 'ruling', comment: 'Some ruling' }],
      };
      mockFetch.mockResolvedValueOnce(createMockResponse(mockRulings));

      const result = await handleGetRulings('abc123');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.scryfall.com/cards/abc123/rulings'
      );
      expect(result.isError).toBe(false);
    });
  });

  describe('handleGetPricesById', () => {
    it('should return prices from card data', async () => {
      const mockCard = {
        object: 'card',
        name: 'Lightning Bolt',
        prices: { usd: '1.50', usd_foil: '3.00', eur: '1.20', tix: '0.05' },
      };
      mockFetch.mockResolvedValueOnce(createMockResponse(mockCard));

      const result = await handleGetPricesById('abc123');

      expect(result.isError).toBe(false);
      const priceData = JSON.parse(result.content[0].text);
      expect(priceData.usd).toBe('1.50');
    });

    it('should handle card with no prices', async () => {
      const mockCard = { object: 'card', name: 'Some Card' };
      mockFetch.mockResolvedValueOnce(createMockResponse(mockCard));

      const result = await handleGetPricesById('abc123');

      expect(result.isError).toBe(false);
      expect(result.content[0].text).toBe('No price information found for this card.');
    });
  });

  describe('handleGetPricesByName', () => {
    it('should return prices for card by name', async () => {
      const mockCard = {
        object: 'card',
        name: 'Black Lotus',
        prices: { usd: '50000.00' },
      };
      mockFetch.mockResolvedValueOnce(createMockResponse(mockCard));

      const result = await handleGetPricesByName('Black Lotus');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.scryfall.com/cards/named?exact=Black%20Lotus'
      );
      expect(result.isError).toBe(false);
    });
  });

  describe('handleListSets', () => {
    it('should call sets endpoint', async () => {
      const mockSets = {
        object: 'list',
        data: [{ object: 'set', code: 'aer', name: 'Aether Revolt' }],
      };
      mockFetch.mockResolvedValueOnce(createMockResponse(mockSets));

      const result = await handleListSets();

      expect(mockFetch).toHaveBeenCalledWith('https://api.scryfall.com/sets');
      expect(result.isError).toBe(false);
    });
  });

  describe('handleGetSetByCode', () => {
    it('should call sets endpoint with code', async () => {
      const mockSet = { object: 'set', code: 'aer', name: 'Aether Revolt' };
      mockFetch.mockResolvedValueOnce(createMockResponse(mockSet));

      const result = await handleGetSetByCode('aer');

      expect(mockFetch).toHaveBeenCalledWith('https://api.scryfall.com/sets/aer');
      expect(result.isError).toBe(false);
    });
  });

  describe('handleGetSetById', () => {
    it('should call sets endpoint with ID', async () => {
      const mockSet = { object: 'set', id: 'abc123', name: 'Some Set' };
      mockFetch.mockResolvedValueOnce(createMockResponse(mockSet));

      const result = await handleGetSetById('abc123');

      expect(mockFetch).toHaveBeenCalledWith('https://api.scryfall.com/sets/abc123');
      expect(result.isError).toBe(false);
    });
  });

  describe('handleGetSetByTcgplayerId', () => {
    it('should call TCGplayer sets endpoint', async () => {
      const mockSet = { object: 'set', name: 'Some Set' };
      mockFetch.mockResolvedValueOnce(createMockResponse(mockSet));

      const result = await handleGetSetByTcgplayerId('12345');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.scryfall.com/sets/tcgplayer/12345'
      );
      expect(result.isError).toBe(false);
    });
  });

  describe('handleListSymbology', () => {
    it('should call symbology endpoint', async () => {
      const mockSymbols = {
        object: 'list',
        data: [{ object: 'card_symbol', symbol: '{W}' }],
      };
      mockFetch.mockResolvedValueOnce(createMockResponse(mockSymbols));

      const result = await handleListSymbology();

      expect(mockFetch).toHaveBeenCalledWith('https://api.scryfall.com/symbology');
      expect(result.isError).toBe(false);
    });
  });

  describe('handleParseManaCost', () => {
    it('should call parse-mana endpoint with encoded cost', async () => {
      const mockManaCost = {
        object: 'mana_cost',
        cost: '{2}{W}{U}',
        cmc: 4,
        colors: ['W', 'U'],
      };
      mockFetch.mockResolvedValueOnce(createMockResponse(mockManaCost));

      const result = await handleParseManaCost('{2}{W}{U}');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.scryfall.com/symbology/parse-mana?cost=%7B2%7D%7BW%7D%7BU%7D'
      );
      expect(result.isError).toBe(false);
    });
  });
});
