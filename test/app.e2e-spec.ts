import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule } from '@nestjs/config';
import * as request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { AppModule } from '../src/app.module';
import axios from 'axios';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('URL Content Fetcher E2E', () => {
  let app: INestApplication;
  let mongoServer: MongoMemoryServer;

  beforeAll(async () => {
    // Start in-memory MongoDB
    mongoServer = await MongoMemoryServer.create();
    const mongoUri = mongoServer.getUri();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [
            () => ({
              port: 3000,
              mongodb: { uri: mongoUri },
              contentFetching: {
                sizeLimit: 5242880,
                maxRedirects: 5,
              },
              refetch: {
                intervalHours: 12,
                checkIntervalMinutes: 30,
              },
            }),
          ],
        }),
        MongooseModule.forRoot(mongoUri),
        AppModule,
      ],
    })
      .overrideProvider(AppModule)
      .useValue({})
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );

    await app.init();
  });

  afterAll(async () => {
    await app.close();
    await mongoServer.stop();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('/urls (POST)', () => {
    it('should store valid URLs and return success results', async () => {
      const testUrl = 'https://example.com';
      const mockContent = '<!DOCTYPE html><html><body>Test Content</body></html>';

      mockedAxios.get.mockResolvedValue({
        status: 200,
        data: mockContent,
        headers: { 'content-type': 'text/html; charset=UTF-8' },
      });

      const response = await request(app.getHttpServer())
        .post('/urls')
        .send({ urls: [testUrl] })
        .expect(200);

      expect(response.body).toHaveProperty('success');
      expect(response.body).toHaveProperty('failed');
      expect(response.body.success).toHaveLength(1);
      expect(response.body.success[0].url).toBe(testUrl);
      expect(response.body.success[0].status).toBe('success');
      expect(response.body.success[0].content).toBe(mockContent);
      expect(response.body.failed).toHaveLength(0);
    });

    it('should handle multiple URLs in single request', async () => {
      const urls = ['https://site1.com', 'https://site2.com'];

      mockedAxios.get
        .mockResolvedValueOnce({
          status: 200,
          data: '<html>Site 1</html>',
          headers: { 'content-type': 'text/html' },
        })
        .mockResolvedValueOnce({
          status: 200,
          data: '<html>Site 2</html>',
          headers: { 'content-type': 'text/html' },
        });

      const response = await request(app.getHttpServer())
        .post('/urls')
        .send({ urls })
        .expect(200);

      expect(response.body.success).toHaveLength(2);
      expect(response.body.failed).toHaveLength(0);
    });

    it('should handle network errors gracefully', async () => {
      const testUrl = 'https://failing-site.com';

      mockedAxios.get.mockRejectedValue(new Error('Network error'));

      const response = await request(app.getHttpServer())
        .post('/urls')
        .send({ urls: [testUrl] })
        .expect(200);

      expect(response.body.success).toHaveLength(0);
      expect(response.body.failed).toHaveLength(1);
      expect(response.body.failed[0].url).toBe(testUrl);
      expect(response.body.failed[0].status).toBe('error');
      expect(response.body.failed[0].errorMessage).toBeDefined();
    });

    it('should handle mix of success and failure', async () => {
      const urls = ['https://success.com', 'https://fail.com'];

      mockedAxios.get
        .mockResolvedValueOnce({
          status: 200,
          data: '<html>Success</html>',
          headers: { 'content-type': 'text/html' },
        })
        .mockRejectedValueOnce(new Error('Failed'));

      const response = await request(app.getHttpServer())
        .post('/urls')
        .send({ urls })
        .expect(200);

      expect(response.body.success).toHaveLength(1);
      expect(response.body.failed).toHaveLength(1);
      expect(response.body.success[0].url).toBe('https://success.com');
      expect(response.body.failed[0].url).toBe('https://fail.com');
    });

    it('should return 400 for invalid request body', async () => {
      await request(app.getHttpServer())
        .post('/urls')
        .send({ urls: 'not-an-array' })
        .expect(400);
    });

    it('should return 400 for empty urls array', async () => {
      await request(app.getHttpServer()).post('/urls').send({ urls: [] }).expect(400);
    });

    it('should return 400 for missing urls field', async () => {
      await request(app.getHttpServer()).post('/urls').send({}).expect(400);
    });

    it('should handle duplicate URL requests', async () => {
      const testUrl = 'https://duplicate.com';

      mockedAxios.get.mockResolvedValue({
        status: 200,
        data: '<html>Content</html>',
        headers: { 'content-type': 'text/html' },
      });

      // First request
      const firstResponse = await request(app.getHttpServer())
        .post('/urls')
        .send({ urls: [testUrl] })
        .expect(200);

      expect(firstResponse.body.success).toHaveLength(1);

      // Second request with same URL
      const secondResponse = await request(app.getHttpServer())
        .post('/urls')
        .send({ urls: [testUrl] })
        .expect(200);

      expect(secondResponse.body.success).toHaveLength(1);
      expect(mockedAxios.get).toHaveBeenCalledTimes(1); // Should not fetch again
    });

    it('should handle redirects', async () => {
      const testUrl = 'https://old.com';
      const redirectUrl = 'https://new.com';

      mockedAxios.get
        .mockResolvedValueOnce({
          status: 301,
          headers: { location: redirectUrl },
        })
        .mockResolvedValueOnce({
          status: 200,
          data: '<html>Redirected Content</html>',
          headers: { 'content-type': 'text/html' },
        });

      const response = await request(app.getHttpServer())
        .post('/urls')
        .send({ urls: [testUrl] })
        .expect(200);

      expect(response.body.success).toHaveLength(1);
      // URL constructor normalizes URLs, so https://new.com becomes https://new.com/
      expect(response.body.success[0].redirects).toBeDefined();
      expect(response.body.success[0].redirects[0]).toMatch(/^https:\/\/new\.com\/?$/);
      expect(response.body.success[0].finalUrl).toMatch(/^https:\/\/new\.com\/?$/);
    });

    it('should reject URLs with too many redirects', async () => {
      const testUrl = 'https://infinite-redirect.com';

      // Mock infinite redirects
      mockedAxios.get.mockResolvedValue({
        status: 301,
        headers: { location: 'https://infinite-redirect.com/next' },
      });

      const response = await request(app.getHttpServer())
        .post('/urls')
        .send({ urls: [testUrl] })
        .expect(200);

      expect(response.body.success).toHaveLength(0);
      expect(response.body.failed).toHaveLength(1);
      expect(response.body.failed[0].errorMessage).toContain('redirect');
    });
  });

  describe('/urls (GET)', () => {
    beforeEach(async () => {
      // Clear any existing data
      mockedAxios.get.mockClear();
    });

    it('should return all stored URLs with content', async () => {
      const testUrl = 'https://get-test.com';
      const mockContent = '<html>Get Test</html>';

      mockedAxios.get.mockResolvedValue({
        status: 200,
        data: mockContent,
        headers: { 'content-type': 'text/html' },
      });

      // Store a URL first
      await request(app.getHttpServer())
        .post('/urls')
        .send({ urls: [testUrl] })
        .expect(200);

      // Retrieve all URLs
      const response = await request(app.getHttpServer()).get('/urls').expect(200);

      expect(response.body).toHaveProperty('urls');
      expect(Array.isArray(response.body.urls)).toBe(true);
      
      const storedUrl = response.body.urls.find((u) => u.url === testUrl);
      expect(storedUrl).toBeDefined();
      expect(storedUrl.content).toBe(mockContent);
      expect(storedUrl.status).toBe('success');
    });

    it('should return URLs with error status', async () => {
      const testUrl = 'https://error-test.com';

      mockedAxios.get.mockRejectedValue(new Error('Fetch failed'));

      // Store a failing URL
      await request(app.getHttpServer())
        .post('/urls')
        .send({ urls: [testUrl] })
        .expect(200);

      // Retrieve all URLs
      const response = await request(app.getHttpServer()).get('/urls').expect(200);

      const failedUrl = response.body.urls.find((u) => u.url === testUrl);
      expect(failedUrl).toBeDefined();
      expect(failedUrl.status).toBe('error');
      expect(failedUrl.errorMessage).toBeDefined();
      expect(failedUrl.content).toBeUndefined();
    });

    it('should include metadata in response', async () => {
      const testUrl = 'https://metadata-test.com';
      const mockContent = '<html>Metadata</html>';

      mockedAxios.get.mockResolvedValue({
        status: 200,
        data: mockContent,
        headers: { 'content-type': 'text/html; charset=UTF-8' },
      });

      await request(app.getHttpServer())
        .post('/urls')
        .send({ urls: [testUrl] })
        .expect(200);

      const response = await request(app.getHttpServer()).get('/urls').expect(200);

      const storedUrl = response.body.urls.find((u) => u.url === testUrl);
      expect(storedUrl.contentType).toBeDefined();
      expect(storedUrl.contentLength).toBeDefined();
      expect(storedUrl.createdAt).toBeDefined();
      expect(storedUrl.updatedAt).toBeDefined();
    });
  });

  describe('Complete Flow', () => {
    it('should handle complete store and retrieve flow', async () => {
      const testUrls = ['https://flow1.com', 'https://flow2.com', 'https://flow-fail.com'];

      mockedAxios.get
        .mockResolvedValueOnce({
          status: 200,
          data: '<html>Flow 1</html>',
          headers: { 'content-type': 'text/html' },
        })
        .mockResolvedValueOnce({
          status: 200,
          data: '<html>Flow 2</html>',
          headers: { 'content-type': 'text/html' },
        })
        .mockRejectedValueOnce(new Error('Flow fail'));

      // Store URLs
      const storeResponse = await request(app.getHttpServer())
        .post('/urls')
        .send({ urls: testUrls })
        .expect(200);

      expect(storeResponse.body.success).toHaveLength(2);
      expect(storeResponse.body.failed).toHaveLength(1);

      // Retrieve all URLs
      const getResponse = await request(app.getHttpServer()).get('/urls').expect(200);

      expect(getResponse.body.urls.length).toBeGreaterThanOrEqual(3);

      const flow1 = getResponse.body.urls.find((u) => u.url === 'https://flow1.com');
      const flow2 = getResponse.body.urls.find((u) => u.url === 'https://flow2.com');
      const flowFail = getResponse.body.urls.find((u) => u.url === 'https://flow-fail.com');

      expect(flow1.status).toBe('success');
      expect(flow1.content).toBe('<html>Flow 1</html>');
      expect(flow2.status).toBe('success');
      expect(flow2.content).toBe('<html>Flow 2</html>');
      expect(flowFail.status).toBe('error');
      expect(flowFail.errorMessage).toBeDefined();
    });

    it('should persist data across multiple requests', async () => {
      const url1 = 'https://persist1.com';
      const url2 = 'https://persist2.com';

      mockedAxios.get
        .mockResolvedValueOnce({
          status: 200,
          data: '<html>Persist 1</html>',
          headers: { 'content-type': 'text/html' },
        })
        .mockResolvedValueOnce({
          status: 200,
          data: '<html>Persist 2</html>',
          headers: { 'content-type': 'text/html' },
        });

      // First request - store URL 1
      await request(app.getHttpServer()).post('/urls').send({ urls: [url1] }).expect(200);

      // Get all URLs - should have URL 1
      const firstGet = await request(app.getHttpServer()).get('/urls').expect(200);
      const url1Data = firstGet.body.urls.find((u) => u.url === url1);
      expect(url1Data).toBeDefined();
      expect(url1Data.content).toBe('<html>Persist 1</html>');

      // Second request - store URL 2
      await request(app.getHttpServer()).post('/urls').send({ urls: [url2] }).expect(200);

      // Get all URLs - should have both URL 1 and URL 2
      const secondGet = await request(app.getHttpServer()).get('/urls').expect(200);
      const url1DataAgain = secondGet.body.urls.find((u) => u.url === url1);
      const url2Data = secondGet.body.urls.find((u) => u.url === url2);

      // Verify URL 1 still exists with same content (persistence)
      expect(url1DataAgain).toBeDefined();
      expect(url1DataAgain.content).toBe('<html>Persist 1</html>');

      // Verify URL 2 was added
      expect(url2Data).toBeDefined();
      expect(url2Data.content).toBe('<html>Persist 2</html>');
    });
  });
});

