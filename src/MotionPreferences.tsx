import * as React from 'react';
import { MotionConfig } from 'framer-motion';

export function MotionPreferences({ children }: React.PropsWithChildren) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
