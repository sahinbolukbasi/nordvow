import http from "k6/http";
import { check, sleep } from "k6";

export const options = {
  stages: [
    { duration: "30s", target: 15 },
    { duration: "2m", target: 40 },
    { duration: "30s", target: 0 },
  ],
  thresholds: {
    http_req_duration: ["p(95)<500", "p(99)<1200"],
    http_req_failed: ["rate<0.01"],
  },
};

const BASE_URL = __ENV.TARGET_URL || "https://nordvow.com";

export default function () {
  const health = http.get(`${BASE_URL}/api/health`);
  check(health, { "health 200": (r) => r.status === 200 });

  const home = http.get(`${BASE_URL}/`);
  check(home, { "landing 200": (r) => r.status === 200 });
  sleep(1);
}

