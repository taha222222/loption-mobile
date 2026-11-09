// The web build must never load react-native-maps (a native-only module that
// crashes the browser at start-up); DriverMap.web.tsx shows the driver's
// shared position with a link to a map instead.
import React from 'react';
import { Linking } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';
import * as fs from 'fs';
import * as path from 'path';
import { DriverMap } from '../src/components/maps/DriverMap.web';

it('does not import react-native-maps', () => {
  const src = fs.readFileSync(path.join(__dirname, '../src/components/maps/DriverMap.web.tsx'), 'utf8');
  expect(src).not.toMatch(/from 'react-native-maps'|require\('react-native-maps'\)/);
});

it('waits for a position, then shows it with a map link', async () => {
  const { rerender } = await render(<DriverMap driverLocation={null} orderStatus="picked_up" />);
  expect(screen.getByText('En attente de la position du livreur…')).toBeTruthy();
  const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
  await rerender(<DriverMap driverLocation={{ latitude: 33.5731, longitude: -7.5898 }} orderStatus="on_the_way" />);
  expect(screen.getByText('Le livreur est en route vers vous.')).toBeTruthy();
  expect(screen.getByText('Position du livreur : 33.57310, -7.58980')).toBeTruthy();
  await fireEvent.press(screen.getByLabelText('Voir la position du livreur sur une carte'));
  expect(open).toHaveBeenCalledWith('https://www.google.com/maps/search/?api=1&query=33.5731,-7.5898');
  open.mockRestore();
});
