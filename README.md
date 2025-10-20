# URL Content Fetcher

A NestJS service to store URLs and their content using MongoDB. The service fetches content from URLs, handles redirects, stores metadata, and provides endpoints to store and retrieve URL data.

## Features

- **Store URLs**: POST endpoint to store multiple URLs and their content
- **Retrieve URLs**: GET endpoint to retrieve all stored URLs with their content and metadata
- **Automatic Refetch**: Periodically refetches stale URL content to keep data fresh
- **Redirect Handling**: Follows redirects up to a configurable limit (default: 5)
- **Error Handling**: Gracefully handles errors and stores error information
- **Content Size Limit**: Configurable content size limit (default: 5MB)
- **Separate Collections**: URLs metadata stored in `urls` collection, content stored in `contents` collection
- **Duplicate Detection**: Checks if URL already exists before fetching

## Prerequisites

- Node.js (v18 or higher)
- MongoDB (running locally or remote instance)
- npm or yarn

## Installation

1. Clone the repository and navigate to the project directory:

```bash
cd url-content-fetcher
```

2. Install dependencies:

```bash
npm install
```

3. Create a `.env` file from the example:

```bash
cp .env.example .env
```

4. Configure your environment variables in `.env`:

```env
# MongoDB Configuration
MONGODB_URI=mongodb://localhost:27017/url-content-fetcher

# Server Configuration
PORT=3000

# Content Fetching Configuration
# Content size limit in bytes (default: 5MB = 5242880 bytes)
CONTENT_SIZE_LIMIT=5242880

# Maximum number of redirects to follow (default: 5)
MAX_REDIRECTS=5

# Automatic Refetch Configuration
# Refetch URLs that haven't been updated in this many hours (default: 12)
CONTENT_REFETCH_INTERVAL_HOURS=12

# Check for stale URLs every N minutes (default: 30)
REFETCH_CHECK_INTERVAL_MINUTES=30
```

## Running the Application

### Development Mode

```bash
npm run start:dev
```

### Production Mode

```bash
npm run build
npm run start:prod
```

The application will start on `http://localhost:3000` (or the port specified in your `.env` file).

## API Endpoints

### POST /urls - Store URLs

Store one or more URLs and fetch their content.

**Request:**

```bash
curl -X POST -H "Content-Type: application/json" \
  -d '{"urls": ["https://example.com", "https://google.com"]}' \
  http://localhost:3000/urls
```

**Request Body:**

```json
{
  "urls": ["https://example.com", "https://google.com"]
}
```

**Response (200 OK):**

```json
{
  "success": [
    {
      "url": "https://example.com",
      "status": "success",
      "redirects": [],
      "contentType": "text/html; charset=UTF-8",
      "contentLength": 1256,
      "content": "<!doctype html><html>...</html>",
      "createdAt": "2025-10-19T12:00:00.000Z",
      "updatedAt": "2025-10-19T12:00:00.000Z"
    }
  ],
  "failed": [
    {
      "url": "https://invalid-url-that-does-not-exist.com",
      "status": "error",
      "errorMessage": "getaddrinfo ENOTFOUND invalid-url-that-does-not-exist.com",
      "redirects": [],
      "createdAt": "2025-10-19T12:00:00.000Z",
      "updatedAt": "2025-10-19T12:00:00.000Z"
    }
  ]
}
```

**Response Fields:**

- `success`: Array of successfully fetched URLs
- `failed`: Array of URLs that failed to fetch (with error messages)
- Each URL object contains:
  - `url`: The original URL
  - `status`: Either "success" or "error"
  - `errorMessage`: Error message (only for failed URLs)
  - `redirects`: Array of redirect URLs (if any)
  - `contentType`: Content type from response headers
  - `contentLength`: Length of the content in bytes
  - `finalUrl`: Final URL after following redirects (if different from original)
  - `content`: The actual content (only in success response)
  - `createdAt`, `updatedAt`: Timestamps

### GET /urls - Retrieve All URLs

Retrieve all stored URLs with their content and metadata.

**Request:**

```bash
curl http://localhost:3000/urls
```

**Response (200 OK):**

```json
{
  "urls": [
    {
      "url": "https://example.com",
      "status": "success",
      "redirects": [],
      "contentType": "text/html; charset=UTF-8",
      "contentLength": 1256,
      "content": "<!doctype html><html>...</html>",
      "createdAt": "2025-10-19T12:00:00.000Z",
      "updatedAt": "2025-10-19T12:00:00.000Z"
    },
    {
      "url": "https://invalid-url.com",
      "status": "error",
      "errorMessage": "getaddrinfo ENOTFOUND invalid-url.com",
      "redirects": [],
      "createdAt": "2025-10-19T12:00:00.000Z",
      "updatedAt": "2025-10-19T12:00:00.000Z"
    }
  ]
}
```

## How It Works

### URL Storage Flow

1. **Request Received**: POST request with array of URLs
2. **Duplicate Check**: For each URL, check if it already exists in the database
3. **Content Fetching**: If URL is new, fetch the content:
   - Follow redirects (up to `MAX_REDIRECTS` limit)
   - Check content size against `CONTENT_SIZE_LIMIT`
   - Track all redirect URLs
4. **Storage**:
   - Store URL metadata in `urls` collection (url, status, redirects, contentType, etc.)
   - Store actual content in `contents` collection
5. **Error Handling**: If any error occurs:
   - Log the error
   - Store URL with error status and error message
   - Continue processing other URLs
6. **Response**: Return 200 OK with lists of successful and failed URLs

### Redirect Handling

The service follows HTTP redirects (3xx status codes) up to the configured limit:
- Tracks all redirect URLs in the `redirects` array
- Stores the final URL in `finalUrl` field
- Returns error if redirect limit is exceeded

### Automatic Refetch Mechanism

The service includes an automatic refetch mechanism to keep URL content fresh:

1. **Scheduled Check**: Runs every `REFETCH_CHECK_INTERVAL_MINUTES` minutes (default: 30)
2. **Stale Detection**: Identifies URLs not updated within `CONTENT_REFETCH_INTERVAL_HOURS` hours (default: 12)
3. **Automatic Update**: Refetches content for all stale URLs (both successful and failed)
4. **Smart Retry**: Previously failed URLs get retried automatically - great for handling temporary outages
5. **Status Transitions**: URLs can change from error → success (or vice versa) based on current state
6. **Logging**: Provides detailed logs of refetch operations

**How it works:**
- Every 30 minutes, the service checks for URLs with `updatedAt` timestamp older than 12 hours
- **All stale URLs are refetched** (both successful and failed) - this allows retry of temporary failures
- Content is updated in the database with fresh data
- Metadata (contentType, contentLength, redirects, etc.) is also updated
- URLs can transition between success ↔ error status based on current availability

### Collections Structure

**urls Collection:**
```javascript
{
  url: String (unique),
  status: String (enum: 'success', 'error'),
  errorMessage: String (optional),
  redirects: [String],
  contentType: String,
  contentLength: Number,
  finalUrl: String,
  contentId: ObjectId (reference to contents collection),
  createdAt: Date,
  updatedAt: Date
}
```

**contents Collection:**
```javascript
{
  url: String (unique),
  content: String,
  createdAt: Date,
  updatedAt: Date
}
```

## Configuration

All configuration is done through environment variables in the `.env` file:

| Variable | Description | Default |
|----------|-------------|---------|
| `MONGODB_URI` | MongoDB connection string | `mongodb://localhost:27017/url-content-fetcher` |
| `PORT` | Server port | `3000` |
| `CONTENT_SIZE_LIMIT` | Maximum content size in bytes | `5242880` (5MB) |
| `MAX_REDIRECTS` | Maximum number of redirects to follow | `5` |
| `CONTENT_REFETCH_INTERVAL_HOURS` | Hours before a URL is considered stale and needs refetching | `12` |
| `REFETCH_CHECK_INTERVAL_MINUTES` | Minutes between automatic refetch checks | `30` |

## Error Handling

The service implements comprehensive error handling:

1. **Network Errors**: DNS resolution failures, connection timeouts, etc.
2. **HTTP Errors**: 4xx and 5xx status codes
3. **Content Size Errors**: Content exceeding size limit
4. **Redirect Errors**: Too many redirects
5. **Database Errors**: MongoDB connection or operation failures

All errors are:
- Logged to the console with context
- Stored in the database with the URL
- Returned in the response with error messages

## Development

### Project Structure

```
src/
├── config/
│   └── configuration.ts           # Configuration loader
├── modules/
│   └── url/
│       ├── dto/
│       │   ├── store-urls.dto.ts        # Request DTOs
│       │   └── url-response.dto.ts     # Response DTOs
│       ├── schemas/
│       │   ├── url.schema.ts            # URL metadata schema
│       │   └── content.schema.ts        # Content schema
│       ├── url.controller.ts            # HTTP endpoints
│       ├── url.service.ts               # Business logic
│       ├── url-refresh.scheduler.ts     # Background refetch scheduler
│       └── url.module.ts                # Module configuration
├── app.module.ts
└── main.ts
```

### Scripts

- `npm run start:dev` - Start in development mode with watch
- `npm run start:prod` - Start in production mode
- `npm run build` - Build the application
- `npm run format` - Format code with Prettier
- `npm run lint` - Lint code with ESLint
- `npm run test` - Run unit tests
- `npm run test:watch` - Run tests in watch mode
- `npm run test:cov` - Run tests with coverage report
- `npm run test:e2e` - Run end-to-end tests

## Testing

The project includes comprehensive unit tests and E2E tests.

### Running Tests

```bash
# Unit tests
npm run test

# Watch mode
npm run test:watch

# Coverage report
npm run test:cov

# E2E tests
npm run test:e2e

# All tests
npm run test && npm run test:e2e
```

### Test Coverage

The project maintains high test coverage:
- **Unit Tests**: UrlService, UrlRefreshScheduler, UrlController
- **E2E Tests**: Complete API flow with in-memory MongoDB
- **Coverage Target**: 80% for branches, functions, lines, and statements

### Test Structure

```
src/
├── modules/url/
│   ├── url.service.spec.ts           # UrlService unit tests
│   ├── url-refresh.scheduler.spec.ts # Scheduler unit tests
│   └── url.controller.spec.ts        # Controller unit tests
test/
└── app.e2e-spec.ts                   # End-to-end tests
```

## 🚀 Deployment

### GCP Compute Engine (Docker Compose)

See [DEPLOYMENT.md](DEPLOYMENT.md) for complete deployment guide.

**Quick Deploy:**

```bash
# On your GCP instance
sudo su -
curl -o deploy.sh https://raw.githubusercontent.com/davidori/url-content-fetcher/main/deploy.sh
chmod +x deploy.sh
export GITHUB_REPO="https://github.com/davidori/url-content-fetcher.git"
./deploy.sh
```

The application will be available at: `http://YOUR_INSTANCE_IP:8080`

### Local Development with Docker

```bash
# Build and start
docker-compose up -d

# View logs
docker-compose logs -f

# Stop
docker-compose down
```

### Production Deployment Checklist

- ✅ Update MongoDB password in `.env.production`
- ✅ Configure GCP firewall rules (port 8080)
- ✅ Set up SSL/TLS with reverse proxy (optional)
- ✅ Configure backups for MongoDB
- ✅ Monitor application logs
- ✅ Set up alerts for service health

## License

MIT

