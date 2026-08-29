import coreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

/** eslint-config-next 16 ships native flat configs, so no FlatCompat shim is needed. */
const config = [
  { ignores: [".next/**", "node_modules/**", "out/**", "build/**", "next-env.d.ts"] },
  ...coreWebVitals,
  ...nextTypescript,
];

export default config;
