import { defineConfig } from "vite";

export default defineConfig({
  base: "/blocktile/",
  test: {
    environment: "jsdom",
  },
});
