import { defineCliConfig } from "sanity/cli";

export default defineCliConfig({
  api: {
    projectId: "qiytv9xa",
    dataset: "production",
  },
  // Deploys to https://musicforkhushi.sanity.studio
  // (must be globally unique — change this if the name is taken).
  studioHost: "musicforkhushi",
});
