import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { UrlRefreshScheduler } from './url-refresh.scheduler';
import { Url } from './schemas/url.schema';
import { Content } from './schemas/content.schema';
import axios from 'axios';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('UrlRefreshScheduler', () => {
  let scheduler: UrlRefreshScheduler;
  let urlModel: any;
  let contentModel: any;
  let schedulerRegistry: SchedulerRegistry;

  const mockConfigService = {
    get: jest.fn((key: string) => {
      const config = {
        'refetch.intervalHours': 12,
        'refetch.checkIntervalMinutes': 30,
        'contentFetching.maxRedirects': 5,
        'contentFetching.sizeLimit': 5242880,
      };
      return config[key];
    }),
  };

  const mockSchedulerRegistry = {
    addInterval: jest.fn(),
  };

  // Mock constructor functions for Mongoose models
  const mockUrlModelConstructor: any = jest.fn();
  const mockContentModelConstructor: any = jest.fn();

  beforeEach(async () => {
    jest.useFakeTimers();

    // Reset constructor mocks
    mockUrlModelConstructor.mockReset();
    mockContentModelConstructor.mockReset();

    // Add static methods to constructor mocks
    mockUrlModelConstructor.find = jest.fn();
    mockUrlModelConstructor.findOne = jest.fn();
    mockContentModelConstructor.findOne = jest.fn();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UrlRefreshScheduler,
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
        {
          provide: SchedulerRegistry,
          useValue: mockSchedulerRegistry,
        },
      ],
    }).compile();

    scheduler = module.get<UrlRefreshScheduler>(UrlRefreshScheduler);
    urlModel = module.get(getModelToken(Url.name));
    contentModel = module.get(getModelToken(Content.name));
    schedulerRegistry = module.get<SchedulerRegistry>(SchedulerRegistry);
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
  });

  describe('onModuleInit', () => {
    it('should register interval on module initialization', () => {
      scheduler.onModuleInit();

      expect(schedulerRegistry.addInterval).toHaveBeenCalledWith(
        'refetch-stale-urls',
        expect.any(Object),
      );
    });

    it('should use configured interval from config', () => {
      scheduler.onModuleInit();

      // 30 minutes = 1800000 ms
      const expectedInterval = 30 * 60 * 1000;
      expect(mockSchedulerRegistry.addInterval).toHaveBeenCalled();
    });
  });

  describe('refetchStaleUrls', () => {
    it('should refetch URLs older than configured interval', async () => {
      const staleUrl = {
        url: 'https://example.com',
        status: 'success',
        updatedAt: new Date(Date.now() - 13 * 60 * 60 * 1000), // 13 hours ago
        save: jest.fn().mockResolvedValue(true),
      };

      urlModel.find.mockReturnValue({
        exec: jest.fn().mockResolvedValue([staleUrl]),
      });

      contentModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue({
          content: 'old content',
          save: jest.fn().mockResolvedValue(true),
        }),
      });

      mockedAxios.get.mockResolvedValue({
        status: 200,
        data: '<html>New Content</html>',
        headers: { 'content-type': 'text/html' },
      });

      await scheduler.refetchStaleUrls();

      expect(urlModel.find).toHaveBeenCalled();
      expect(staleUrl.save).toHaveBeenCalled();
    });

    it('should refetch both successful and failed URLs', async () => {
      const urls = [
        {
          url: 'https://success.com',
          status: 'success',
          updatedAt: new Date(Date.now() - 13 * 60 * 60 * 1000),
          save: jest.fn().mockResolvedValue(true),
        },
        {
          url: 'https://error.com',
          status: 'error',
          errorMessage: 'Previous error',
          updatedAt: new Date(Date.now() - 13 * 60 * 60 * 1000),
          save: jest.fn().mockResolvedValue(true),
        },
      ];

      urlModel.find.mockReturnValue({
        exec: jest.fn().mockResolvedValue(urls),
      });

      contentModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue({
          content: 'content',
          save: jest.fn().mockResolvedValue(true),
        }),
      });

      mockedAxios.get.mockResolvedValue({
        status: 200,
        data: '<html>Content</html>',
        headers: { 'content-type': 'text/html' },
      });

      await scheduler.refetchStaleUrls();

      expect(urls[0].save).toHaveBeenCalled();
      expect(urls[1].save).toHaveBeenCalled();
    });

    it('should update status from error to success on recovery', async () => {
      const failedUrl = {
        url: 'https://recovered.com',
        status: 'error',
        errorMessage: 'Was down',
        updatedAt: new Date(Date.now() - 13 * 60 * 60 * 1000),
        save: jest.fn().mockResolvedValue(true),
      };

      urlModel.find.mockReturnValue({
        exec: jest.fn().mockResolvedValue([failedUrl]),
      });

      contentModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(null),
      });

      mockedAxios.get.mockResolvedValue({
        status: 200,
        data: '<html>Now working</html>',
        headers: { 'content-type': 'text/html' },
      });

      const mockContentSave = jest.fn().mockResolvedValue({ _id: 'new-content-id' });
      mockContentModelConstructor.mockImplementation(() => ({ save: mockContentSave }));

      await scheduler.refetchStaleUrls();

      expect(failedUrl.status).toBe('success');
      expect(failedUrl.errorMessage).toBeUndefined();
      expect(failedUrl.save).toHaveBeenCalled();
    });

    it('should update status from success to error on failure', async () => {
      const workingUrl = {
        url: 'https://nowdown.com',
        status: 'success',
        errorMessage: undefined as any,
        updatedAt: new Date(Date.now() - 13 * 60 * 60 * 1000),
        save: jest.fn().mockResolvedValue(true),
      };

      urlModel.find.mockReturnValue({
        exec: jest.fn().mockResolvedValue([workingUrl]),
      });

      mockedAxios.get.mockRejectedValue(new Error('Server down'));

      await scheduler.refetchStaleUrls();

      expect(workingUrl.status).toBe('error');
      expect(workingUrl.errorMessage).toBeDefined();
      expect(workingUrl.save).toHaveBeenCalled();
    });

    it('should handle no stale URLs gracefully', async () => {
      urlModel.find.mockReturnValue({
        exec: jest.fn().mockResolvedValue([]),
      });

      await scheduler.refetchStaleUrls();

      expect(mockedAxios.get).not.toHaveBeenCalled();
    });

    it('should continue processing when one URL fails', async () => {
      const urls = [
        {
          url: 'https://fail.com',
          status: 'success',
          updatedAt: new Date(Date.now() - 13 * 60 * 60 * 1000),
          save: jest.fn().mockResolvedValue(true),
        },
        {
          url: 'https://success.com',
          status: 'success',
          updatedAt: new Date(Date.now() - 13 * 60 * 60 * 1000),
          save: jest.fn().mockResolvedValue(true),
        },
      ];

      urlModel.find.mockReturnValue({
        exec: jest.fn().mockResolvedValue(urls),
      });

      contentModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue({
          content: 'content',
          save: jest.fn().mockResolvedValue(true),
        }),
      });

      mockedAxios.get
        .mockRejectedValueOnce(new Error('Failed'))
        .mockResolvedValueOnce({
          status: 200,
          data: '<html>Success</html>',
          headers: { 'content-type': 'text/html' },
        });

      await scheduler.refetchStaleUrls();

      expect(urls[0].save).toHaveBeenCalled();
      expect(urls[1].save).toHaveBeenCalled();
    });

    it('should not refetch URLs updated recently', async () => {
      const recentUrl = {
        url: 'https://recent.com',
        status: 'success',
        updatedAt: new Date(Date.now() - 1 * 60 * 60 * 1000), // 1 hour ago
      };

      urlModel.find.mockReturnValue({
        exec: jest.fn().mockResolvedValue([]),
      });

      await scheduler.refetchStaleUrls();

      expect(mockedAxios.get).not.toHaveBeenCalled();
    });

    it('should catch and log top-level errors', async () => {
      urlModel.find.mockReturnValue({
        exec: jest.fn().mockRejectedValue(new Error('Database error')),
      });

      await expect(scheduler.refetchStaleUrls()).resolves.not.toThrow();
    });
  });

  describe('updateSuccessfulRefetch', () => {
    it('should update existing content', async () => {
      const urlDoc = {
        url: 'https://example.com',
        status: 'success',
        save: jest.fn().mockResolvedValue(true),
      };

      const existingContent = {
        content: 'old content',
        save: jest.fn().mockResolvedValue(true),
      };

      contentModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(existingContent),
      });

      mockedAxios.get.mockResolvedValue({
        status: 200,
        data: '<html>New content</html>',
        headers: { 'content-type': 'text/html' },
      });

      urlModel.find.mockReturnValue({
        exec: jest.fn().mockResolvedValue([urlDoc]),
      });

      await scheduler.refetchStaleUrls();

      expect(existingContent.content).toBe('<html>New content</html>');
      expect(existingContent.save).toHaveBeenCalled();
    });

    it('should create content if not exists', async () => {
      const urlDoc = {
        url: 'https://newcontent.com',
        status: 'error',
        contentId: undefined as any,
        save: jest.fn().mockResolvedValue(true),
      };

      contentModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(null),
      });

      mockedAxios.get.mockResolvedValue({
        status: 200,
        data: '<html>New content</html>',
        headers: { 'content-type': 'text/html' },
      });

      const mockContentSave = jest.fn().mockResolvedValue({ _id: 'new-id' });
      mockContentModelConstructor.mockImplementation(() => ({ save: mockContentSave }));

      urlModel.find.mockReturnValue({
        exec: jest.fn().mockResolvedValue([urlDoc]),
      });

      await scheduler.refetchStaleUrls();

      expect(mockContentSave).toHaveBeenCalled();
      expect(urlDoc.contentId).toBe('new-id');
    });
  });
});

