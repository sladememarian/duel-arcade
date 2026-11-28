import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Rate } from 'k6/metrics';

const BASE = __ENV.BASE_URL || 'https://amirpouyan.cool-elm.boxd.sh';
const VUS = Number(__ENV.VUS || 10);
const users = JSON.parse(open('./load-users.json'));

const loginTrend = new Trend('login_ms');
const loginFail = new Rate('login_failed');

export const options = {
  scenarios: {
    login: {
      executor: 'per-vu-iterations',
      vus: VUS,
      iterations: 1,
      maxDuration: '60s',
    },
  },
  thresholds: {
    login_failed: ['rate<0.05'],
  },
};

export default function () {
  const user = users[(__VU - 1) % users.length];
  const res = http.post(
    BASE + '/api/auth/login',
    JSON.stringify({ username: user.username, password: 'Loadtest123' }),
    { headers: { 'Content-Type': 'application/json' }, tags: { kind: 'login' } },
  );
  const ok = check(res, {
    'login status is 200': (r) => r.status === 200,
  });
  loginTrend.add(res.timings.duration);
  loginFail.add(!ok);

  if (ok) {
    const me = http.get(BASE + '/api/auth/me', {
      tags: { kind: 'login' },
    });
    check(me, { 'new session is authenticated': (r) => r.status === 200 });
  }
  sleep(0.5);
}
