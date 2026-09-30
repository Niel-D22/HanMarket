import type React from "react";
import { Composition } from "remotion";
import { HanMarketIntro } from "./HanMarketIntro";

export const RemotionRoot: React.FC = () => (
  <Composition id="HanMarketIntro" component={HanMarketIntro} durationInFrames={150} fps={30} width={1920} height={1080} />
);
