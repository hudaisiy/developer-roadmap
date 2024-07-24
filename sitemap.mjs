import path from 'node:path';
import fs from 'node:fs/promises';
import client from 'prom-client';
import express from 'express';
import responseTime from 'response-time';

// Create an express application
const app = express();

// Create a Registry which registers the metrics
const register = new client.Registry();

// Enable collection of default metrics (e.g., CPU, memory, event loop latency)
client.collectDefaultMetrics({ register });

async function getRoadmapIds() {
  return fs.readdir(path.join(process.cwd(), 'src/data/roadmaps'));
}

async function getBestPracticesIds() {
  return fs.readdir(path.join(process.cwd(), 'src/data/best-practices'));
}

export function shouldIndexPage(pageUrl) {
  return ![
    'https://roadmap.sh/404',
    'https://roadmap.sh/terms',
    'https://roadmap.sh/privacy',
    'https://roadmap.sh/pdfs',
    'https://roadmap.sh/g',
  ].includes(pageUrl);
}

export async function serializeSitemap(item) {
  const highPriorityPages = [
    'https://roadmap.sh',
    'https://roadmap.sh/about',
    'https://roadmap.sh/roadmaps',
    'https://roadmap.sh/best-practices',
    'https://roadmap.sh/guides',
    'https://roadmap.sh/videos',
    ...(await getRoadmapIds()).flatMap((id) => [
      `https://roadmap.sh/${id}`,
      `https://roadmap.sh/${id}/topics`,
    ]),
    ...(await getBestPracticesIds()).map(
      (id) => `https://roadmap.sh/best-practices/${id}`
    ),
  ];

  // Roadmaps and other high priority pages
  for (let pageUrl of highPriorityPages) {
    if (item.url === pageUrl) {
      return {
        ...item,
        // @ts-ignore
        changefreq: 'monthly',
        priority: 1,
      };
    }
  }

  // Guide and video pages
  if (
    item.url.startsWith('https://roadmap.sh/guides') ||
    item.url.startsWith('https://roadmap.sh/videos')
  ) {
    return {
      ...item,
      // @ts-ignore
      changefreq: 'monthly',
      priority: 0.9,
    };
  }

  return undefined;
}

// Create a custom counter metric
const counter = new client.Counter({
  name: 'node_request_operations_total',
  help: 'The total number of processed requests'
});

// Create a custom gauge metric
const gauge = new client.Gauge({
  name: 'node_memory_usage_bytes',
  help: 'Memory usage of the Node.js process in bytes',
  async collect() {
    const memoryUsage = process.memoryUsage();
    this.set(memoryUsage.heapUsed);
  }
});

// Register the custom metrics
register.registerMetric(counter);
register.registerMetric(gauge);


// Middleware to measure response time
app.use(responseTime((req, res, time) => {
  // Create a custom histogram metric
  const histogram = new client.Histogram({
    name: 'http_request_duration_seconds',
    help: 'Duration of HTTP requests in seconds',
    labelNames: ['method', 'status_code', 'route'],
    buckets: [0.1, 0.3, 0.5, 1, 1.5, 2, 3] // Define your own buckets
  });
  register.registerMetric(histogram);

  // Record response time
  res.on('finish', () => {
    histogram.labels(req.method, res.statusCode, req.route ? req.route.path : 'unknown').observe(time / 1000);
  });
}));


// Expose Prometheus metrics endpoint
app.get('/metrics', async (req, res) => {
  res.set('Content-Type', register.contentType);
  try {
    const metricsString = await register.metrics();
    res.end(metricsString);
  } catch (error) {
    console.error('Error generating metrics:', error);
    res.status(500).send('Error generating metrics');
  }
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
