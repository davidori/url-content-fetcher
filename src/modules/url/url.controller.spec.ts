import { Test, TestingModule } from '@nestjs/testing';
import { UrlController } from './url.controller';
import { UrlService } from './url.service';
import { StoreUrlsDto } from './dto/store-urls.dto';

describe('UrlController', () => {
  let controller: UrlController;
  let service: UrlService;

  const mockUrlService = {
    storeUrls: jest.fn(),
    getAllUrls: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [UrlController],
      providers: [
        {
          provide: UrlService,
          useValue: mockUrlService,
        },
      ],
    }).compile();

    controller = module.get<UrlController>(UrlController);
    service = module.get<UrlService>(UrlService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /urls', () => {
    it('should call UrlService.storeUrls with correct params', async () => {
      const dto: StoreUrlsDto = {
        urls: ['https://example.com', 'https://test.com'],
      };

      const expectedResponse = {
        success: [
          {
            url: 'https://example.com',
            status: 'success',
            content: '<html>Test</html>',
            redirects: [],
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
        failed: [],
      };

      mockUrlService.storeUrls.mockResolvedValue(expectedResponse);

      const result = await controller.storeUrls(dto);

      expect(service.storeUrls).toHaveBeenCalledWith(dto.urls);
      expect(result).toEqual(expectedResponse);
    });

    it('should return success and failed arrays', async () => {
      const dto: StoreUrlsDto = {
        urls: ['https://success.com', 'https://fail.com'],
      };

      const expectedResponse = {
        success: [
          {
            url: 'https://success.com',
            status: 'success',
            content: '<html>Content</html>',
            redirects: [],
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
        failed: [
          {
            url: 'https://fail.com',
            status: 'error',
            errorMessage: 'Network error',
            redirects: [],
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
      };

      mockUrlService.storeUrls.mockResolvedValue(expectedResponse);

      const result = await controller.storeUrls(dto);

      expect(result.success).toHaveLength(1);
      expect(result.failed).toHaveLength(1);
      expect(result.failed[0].errorMessage).toBeDefined();
    });

    it('should handle empty success array', async () => {
      const dto: StoreUrlsDto = {
        urls: ['https://fail.com'],
      };

      const expectedResponse = {
        success: [],
        failed: [
          {
            url: 'https://fail.com',
            status: 'error',
            errorMessage: 'Failed to fetch',
            redirects: [],
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
      };

      mockUrlService.storeUrls.mockResolvedValue(expectedResponse);

      const result = await controller.storeUrls(dto);

      expect(result.success).toHaveLength(0);
      expect(result.failed).toHaveLength(1);
    });

    it('should handle service errors', async () => {
      const dto: StoreUrlsDto = {
        urls: ['https://example.com'],
      };

      mockUrlService.storeUrls.mockRejectedValue(new Error('Service error'));

      await expect(controller.storeUrls(dto)).rejects.toThrow('Service error');
    });
  });

  describe('GET /urls', () => {
    it('should call UrlService.getAllUrls', async () => {
      const expectedResponse = {
        urls: [
          {
            url: 'https://example.com',
            status: 'success',
            content: '<html>Content</html>',
            redirects: [],
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
      };

      mockUrlService.getAllUrls.mockResolvedValue(expectedResponse);

      const result = await controller.getAllUrls();

      expect(service.getAllUrls).toHaveBeenCalled();
      expect(result).toEqual(expectedResponse);
    });

    it('should return all URLs with content', async () => {
      const expectedResponse = {
        urls: [
          {
            url: 'https://example.com',
            status: 'success',
            content: '<html>Test</html>',
            contentType: 'text/html',
            contentLength: 100,
            redirects: [],
            createdAt: new Date(),
            updatedAt: new Date(),
          },
          {
            url: 'https://test.com',
            status: 'success',
            content: '<html>Test2</html>',
            contentType: 'text/html',
            contentLength: 101,
            redirects: [],
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
      };

      mockUrlService.getAllUrls.mockResolvedValue(expectedResponse);

      const result = await controller.getAllUrls();

      expect(result.urls).toHaveLength(2);
      expect(result.urls[0].content).toBeDefined();
      expect(result.urls[1].content).toBeDefined();
    });

    it('should return URLs with error status', async () => {
      const expectedResponse = {
        urls: [
          {
            url: 'https://fail.com',
            status: 'error',
            errorMessage: 'Failed to fetch',
            redirects: [],
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
      };

      mockUrlService.getAllUrls.mockResolvedValue(expectedResponse);

      const result = await controller.getAllUrls();

      expect(result.urls).toHaveLength(1);
      expect(result.urls[0].status).toBe('error');
      expect(result.urls[0].errorMessage).toBe('Failed to fetch');
      expect(result.urls[0].content).toBeUndefined();
    });

    it('should return empty array when no URLs exist', async () => {
      const expectedResponse = {
        urls: [],
      };

      mockUrlService.getAllUrls.mockResolvedValue(expectedResponse);

      const result = await controller.getAllUrls();

      expect(result.urls).toHaveLength(0);
    });

    it('should handle service errors', async () => {
      mockUrlService.getAllUrls.mockRejectedValue(new Error('Database error'));

      await expect(controller.getAllUrls()).rejects.toThrow('Database error');
    });
  });
});

