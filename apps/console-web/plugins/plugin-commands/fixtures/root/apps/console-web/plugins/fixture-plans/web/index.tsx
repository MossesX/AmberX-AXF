export const plugin = {
  register(rt: any) {
    rt.actions.register('fixture-plans.open', () => rt.navigate('fixture-plans'), { label: 'Open fixture plans' });
    rt.actions.register('fixture-plans.capture', () => rt.openDialog('x'), { label: 'New plan' });
    rt.actions.register('fixture-plans.clear', (_a: unknown, ctx: any) => ctx, { label: 'Clear plans', searchable: false });
  },
};
