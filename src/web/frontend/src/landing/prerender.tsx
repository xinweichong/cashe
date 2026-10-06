import { renderToString } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom';
import { LazyMotion, MotionConfig, domMax } from 'motion/react';
import { LandingPage } from './LandingPage';

// Build-time only (scripts/prerender-landing.mjs): the landing page as HTML,
// served to signed-out visitors at / so it paints before the app's scripts.
export function render(): string {
  return renderToString(
    <LazyMotion features={domMax} strict>
      <MotionConfig reducedMotion="user">
        <StaticRouter location="/"><LandingPage /></StaticRouter>
      </MotionConfig>
    </LazyMotion>,
  );
}
