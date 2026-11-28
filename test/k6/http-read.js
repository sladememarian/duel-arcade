import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Rate } from 'k6/metrics';

const BASE = __ENV.BASE_URL || 'https://amirpouyan.cool-elm.boxd.sh';
const VUS = Number(__ENV.VUS || 100);
const HOLD = __ENV.HOLD || '60s';
const users = JSON.parse(open('./load-users.json'));

const readTrend = new Trend('arcade_read_ms');
const readFail = new Rate('arcade_read_failed');

export const options = {
  discardResponseBodies: true,
  scenarios: {
    reads: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '10s', target: VUS },
        { duration: HOLD, target: VUS },
        { duration: '10s', target: 0 },
      ],
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    'http_req_duration{kind:read}': ['p(95)<500'],
    arcade_read_failed: ['rate<0.01'],
  },
};

const paths = [
  { path: '/api/leaderboard/overall?limit=20', name: 'leaderboard' },
  { path: '/api/prizes', name: 'prizes' },
  { path: '/api/auth/me', name: 'me' },
];

export default function () {
  const user = users[(__VU - 1) % users.length];
  const headers = { Cookie: user.cookie };
  const item = paths[Math.floor(Math.random() * paths.length)];
  const res = http.get(BASE + item.path, {
    headers,
    tags: { kind: 'read', endpoint: item.name },
  });
  const ok = check(res, {
    'read status is 200': (r) => r.status === 200,
  });
  readTrend.add(res.timings.duration);
  readFail.add(!ok);
  sleep(0.5 + Math.random() * 1.5);
}
