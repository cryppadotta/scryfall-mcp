import { jest } from '@jest/globals';

// Mock fetch before importing
jest.unstable_mockModule('node-fetch', () => ({
  default: jest.fn(),
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

const { handleScryfallResponse } = await import('../index.js');

// Helper to create mock response objects
function createMockResponse(
  data: unknown,
  ok = true,
  status = 200,
  statusText = 'OK'
): Parameters<typeof handleScryfallResponse>[0] {
  return {
    ok,
    status,
    statusText,
    json: async () => data,
  } as Parameters<typeof handleScryfallResponse>[0];
}

describe('handleScryfallResponse', () => {
  describe('successful responses', () => {
    it('should return formatted JSON for successful response', async () => {
      const mockData = { object: 'card', name: 'Lightning Bolt' };
      const response = createMockResponse(mockData);

      const result = await handleScryfallResponse(response);

      expect(result.isError).toBe(false);
      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe('text');

      const parsedContent = JSON.parse(result.content[0].text);
      expect(parsedContent.name).toBe('Lightning Bolt');
    });

    it('should pretty-print JSON with 2-space indentation', async () => {
      const mockData = { a: 1, b: 2 };
      const response = createMockResponse(mockData);

      const result = await handleScryfallResponse(response);

      expect(result.content[0].text).toBe(JSON.stringify(mockData, null, 2));
    });
  });

  describe('error responses', () => {
    it('should handle Scryfall error object', async () => {
      const errorData = {
        object: 'error',
        code: 'not_found',
        status: 404,
        details: 'Card not found',
      };
      const response = createMockResponse(errorData, false, 404, 'Not Found');

      const result = await handleScryfallResponse(response);

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Scryfall error');
      expect(result.content[0].text).toContain('Card not found');
      expect(result.content[0].text).toContain('code=not_found');
      expect(result.content[0].text).toContain('status=404');
    });

    it('should handle generic HTTP error when JSON parsing fails', async () => {
      const response = {
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: async () => {
          throw new Error('Invalid JSON');
        },
      } as Parameters<typeof handleScryfallResponse>[0];

      const result = await handleScryfallResponse(response);

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('HTTP error 500');
      expect(result.content[0].text).toContain('Internal Server Error');
    });

    it('should handle non-Scryfall error JSON', async () => {
      const nonScryfallError = { message: 'Some other error' };
      const response = createMockResponse(nonScryfallError, false, 400, 'Bad Request');

      const result = await handleScryfallResponse(response);

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('HTTP error 400');
    });
  });

  describe('response format', () => {
    it('should always return content array with single text element', async () => {
      const mockData = { test: true };
      const response = createMockResponse(mockData);

      const result = await handleScryfallResponse(response);

      expect(Array.isArray(result.content)).toBe(true);
      expect(result.content).toHaveLength(1);
      expect(result.content[0]).toHaveProperty('type', 'text');
      expect(result.content[0]).toHaveProperty('text');
    });

    it('should return isError boolean', async () => {
      const successResponse = createMockResponse({ ok: true });
      const errorResponse = createMockResponse(
        { object: 'error', code: 'test', status: 400, details: 'test' },
        false,
        400
      );

      const successResult = await handleScryfallResponse(successResponse);
      const errorResult = await handleScryfallResponse(errorResponse);

      expect(typeof successResult.isError).toBe('boolean');
      expect(typeof errorResult.isError).toBe('boolean');
      expect(successResult.isError).toBe(false);
      expect(errorResult.isError).toBe(true);
    });
  });
});
