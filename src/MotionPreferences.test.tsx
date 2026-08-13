// @vitest-environment jsdom

import * as React from 'react';
import { render, screen } from '@testing-library/react';
import { MotionConfigContext } from 'framer-motion';
import { describe, expect, it } from 'vitest';
import { MotionPreferences } from './MotionPreferences';

function MotionPreferenceProbe() {
  const config = React.useContext(MotionConfigContext);
  return <output>{config.reducedMotion}</output>;
}

describe('MotionPreferences', () => {
  it('delegates reduced-motion behavior to the user preference', () => {
    render(
      <MotionPreferences>
        <MotionPreferenceProbe />
      </MotionPreferences>
    );

    expect(screen.getByText('user')).toBeTruthy();
  });
});
