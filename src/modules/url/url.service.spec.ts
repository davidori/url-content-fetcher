import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { UrlService } from './url.service';
import { Url } from './schemas/url.schema';
import { Content } from './schemas/content.schema';
import axios from 'axios';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('UrlService', () => {
  let service: UrlService;
  let urlModel: any;
  let contentModel: any;

  const mockConfigService = {
    get: jest.fn((key: string) => {
      const config = {
        'contentFetching.sizeLimit': 5242880,
        'contentFetching.maxRedirects': 5,
      };
      return config[key];
    }),
  };

  // Mock constructor functions for Mongoose models
  const mockUrlModelConstructor: any = jest.fn();
  const mockContentModelConstructor: any = jest.fn();

  beforeEach(async () => {
    // Reset constructor mocks
    mockUrlModelConstructor.mockReset();
    mockContentModelConstructor.mockReset();

    // Add static methods to constructor mocks
    mockUrlModelConstructor.findOne = jest.fn();
    mockUrlModelConstructor.find = jest.fn();
    mockContentModelConstructor.findOne = jest.fn();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UrlService,
        {
          provide: getModelToken(Url.name),
          useValue: mockUrlModelConstructor,
        },
        {
          provide: getModelToken(Content.name),
          useValue: mockContentModelConstructor,
        },
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    service = module.get<UrlService>(UrlService);
    urlModel = module.get(getModelToken(Url.name));
    contentModel = module.get(getModelToken(Content.name));
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('storeUrls', () => {
    it('should successfully fetch and store a valid URL', async () => {
      const testUrl = 'https://example.com';
      const mockContent = '<html>Test Content</html>';

      urlModel.findOne.mockReturnValue({
        populate: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(null),
        }),
      });

      mockedAxios.get.mockResolvedValue({
        status: 200,
        data: mockContent,
        headers: { 'content-type': 'text/html' },
      });

      // Mock Content model constructor
      const mockContentSave = jest.fn().mockResolvedValue({ _id: 'content-id-123' });
      mockContentModelConstructor.mockImplementation(() => ({
        save: mockContentSave,
      }));

      // Mock Url model constructor
      const mockUrlSave = jest.fn().mockResolvedValue({
        url: testUrl,
        status: 'success',
        contentType: 'text/html',
        contentLength: mockContent.length,
        redirects: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      mockUrlModelConstructor.mockImplementation(() => ({
        save: mockUrlSave,
      }));

      const result = await service.storeUrls([testUrl]);

      expect(result.success).toHaveLength(1);
      expect(result.failed).toHaveLength(0);
      expect(result.success[0].url).toBe(testUrl);
      expect(result.success[0].status).toBe('success');
      expect(result.success[0].content).toBe(mockContent);
    });

    it('should return existing URL when already stored with success status', async () => {
      const testUrl = 'https://example.com';
      const existingUrl = {
        url: testUrl,
        status: 'success',
        contentType: 'text/html',
        contentLength: 100,
        redirects: [],
        contentId: { content: 'existing content' },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      urlModel.findOne.mockReturnValue({
        populate: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(existingUrl),
        }),
      });

      const result = await service.storeUrls([testUrl]);

      expect(result.success).toHaveLength(1);
      expect(result.failed).toHaveLength(0);
      expect(result.success[0].url).toBe(testUrl);
      expect(mockedAxios.get).not.toHaveBeenCalled();
    });

    it('should return existing URL in failed array when stored with error status', async () => {
      const testUrl = 'https://example.com';
      const existingUrl = {
        url: testUrl,
        status: 'error',
        errorMessage: 'Previous fetch failed',
        redirects: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      urlModel.findOne.mockReturnValue({
        populate: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(existingUrl),
        }),
      });

      const result = await service.storeUrls([testUrl]);

      expect(result.success).toHaveLength(0);
      expect(result.failed).toHaveLength(1);
      expect(result.failed[0].url).toBe(testUrl);
      expect(result.failed[0].errorMessage).toBe('Previous fetch failed');
    });

    it('should handle network errors and store as failed', async () => {
      const testUrl = 'https://example.com';

      urlModel.findOne.mockReturnValue({
        populate: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(null),
        }),
      });

      mockedAxios.get.mockRejectedValue(new Error('Network error'));

      const mockUrlSave = jest.fn().mockResolvedValue({
        url: testUrl,
        status: 'error',
        errorMessage: 'Network error',
        redirects: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      mockUrlModelConstructor.mockImplementation(() => ({
        save: mockUrlSave,
      }));

      const result = await service.storeUrls([testUrl]);

      expect(result.success).toHaveLength(0);
      expect(result.failed).toHaveLength(1);
      expect(result.failed[0].status).toBe('error');
      expect(result.failed[0].errorMessage).toBeDefined();
    });

    it('should continue processing other URLs when one fails', async () => {
      const urls = ['https://fail.com', 'https://success.com'];

      urlModel.findOne.mockReturnValue({
        populate: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(null),
        }),
      });

      mockedAxios.get
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce({
          status: 200,
          data: '<html>Success</html>',
          headers: { 'content-type': 'text/html' },
        });

      const mockContentSave = jest.fn().mockResolvedValue({ _id: 'content-id' });

      let callCount = 0;
      mockContentModelConstructor.mockImplementation(() => ({
        save: mockContentSave,
      }));
      mockUrlModelConstructor.mockImplementation(() => ({
        save: jest.fn().mockResolvedValue(
          callCount++ === 0
            ? {
                url: 'https://fail.com',
                status: 'error',
                errorMessage: 'Network error',
                redirects: [],
                createdAt: new Date(),
                updatedAt: new Date(),
              }
            : {
                url: 'https://success.com',
                status: 'success',
                redirects: [],
                createdAt: new Date(),
                updatedAt: new Date(),
              },
        ),
      }));

      const result = await service.storeUrls(urls);

      expect(result.success).toHaveLength(1);
      expect(result.failed).toHaveLength(1);
    });

    it('should handle redirects and store them in array', async () => {
      const testUrl = 'https://example.com/old';
      const redirectUrl = 'https://example.com/new';

      urlModel.findOne.mockReturnValue({
        populate: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(null),
        }),
      });

      mockedAxios.get
        .mockResolvedValueOnce({
          status: 301,
          headers: { location: redirectUrl },
        })
        .mockResolvedValueOnce({
          status: 200,
          data: '<html>Content</html>',
          headers: { 'content-type': 'text/html' },
        });

      const mockContentSave = jest.fn().mockResolvedValue({ _id: 'content-id' });
      const mockUrlSave = jest.fn().mockResolvedValue({
        url: testUrl,
        status: 'success',
        redirects: [redirectUrl],
        finalUrl: redirectUrl,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      mockContentModelConstructor.mockImplementation(() => ({ save: mockContentSave }));
      mockUrlModelConstructor.mockImplementation(() => ({ save: mockUrlSave }));

      const result = await service.storeUrls([testUrl]);

      expect(result.success).toHaveLength(1);
      expect(result.success[0].redirects).toContain(redirectUrl);
    });

    it('should reject URLs with too many redirects', async () => {
      const testUrl = 'https://example.com';

      urlModel.findOne.mockReturnValue({
        populate: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(null),
        }),
      });

      // Mock 6 redirects (exceeds limit of 5)
      mockedAxios.get.mockResolvedValue({
        status: 301,
        headers: { location: 'https://example.com/redirect' },
      });

      const mockUrlSave = jest.fn().mockResolvedValue({
        url: testUrl,
        status: 'error',
        errorMessage: 'Too many redirects',
        redirects: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      mockUrlModelConstructor.mockImplementation(() => ({ save: mockUrlSave }));

      const result = await service.storeUrls([testUrl]);

      expect(result.failed).toHaveLength(1);
      expect(result.failed[0].errorMessage).toContain('redirect');
    });

    it('should handle empty URL array', async () => {
      const result = await service.storeUrls([]);

      expect(result.success).toHaveLength(0);
      expect(result.failed).toHaveLength(0);
    });
  });

  describe('getAllUrls', () => {
    it('should return all URLs with their content', async () => {
      const mockUrls = [
        {
          url: 'https://example.com',
          status: 'success',
          contentType: 'text/html',
          contentId: { content: '<html>Test</html>' },
          redirects: [],
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      urlModel.find.mockReturnValue({
        populate: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(mockUrls),
        }),
      });

      const result = await service.getAllUrls();

      expect(result.urls).toHaveLength(1);
      expect(result.urls[0].url).toBe('https://example.com');
      expect(result.urls[0].content).toBe('<html>Test</html>');
    });

    it('should return URLs without content for error status', async () => {
      const mockUrls = [
        {
          url: 'https://fail.com',
          status: 'error',
          errorMessage: 'Failed to fetch',
          redirects: [],
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      urlModel.find.mockReturnValue({
        populate: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(mockUrls),
        }),
      });

      const result = await service.getAllUrls();

      expect(result.urls).toHaveLength(1);
      expect(result.urls[0].status).toBe('error');
      expect(result.urls[0].errorMessage).toBe('Failed to fetch');
      expect(result.urls[0].content).toBeUndefined();
    });

    it('should return empty array when no URLs exist', async () => {
      urlModel.find.mockReturnValue({
        populate: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue([]),
        }),
      });

      const result = await service.getAllUrls();

      expect(result.urls).toHaveLength(0);
    });
  });
});

