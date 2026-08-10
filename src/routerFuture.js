// Opt into React Router v7 behaviour while still on v6. v7 itself is not usable
// here yet: it publishes the `react-router/dom` subpath through package
// `exports`, which the Jest resolver bundled with react-scripts 5 cannot read.
export const routerFuture = {
  v7_startTransition: true,
  v7_relativeSplatPath: true,
};
