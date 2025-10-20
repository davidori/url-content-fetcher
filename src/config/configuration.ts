export default () => ({
  port: parseInt(process.env.PORT, 10) || 3000,
  mongodb: {
    uri: process.env.MONGODB_URI || 'mongodb://localhost:27017/url-content-fetcher',
  },
  contentFetching: {
    sizeLimit: parseInt(process.env.CONTENT_SIZE_LIMIT, 10) || 5242880, // 5MB default
    maxRedirects: parseInt(process.env.MAX_REDIRECTS, 10) || 5,
  },
  refetch: {
    intervalHours: parseInt(process.env.CONTENT_REFETCH_INTERVAL_HOURS, 10) || 1, // 12 hours default
    checkIntervalMinutes: parseInt(process.env.REFETCH_CHECK_INTERVAL_MINUTES, 10) || 1, // 30 minutes default
  },
});

