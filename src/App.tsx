import { useCreateRoutes } from "neouter";
import { Layout } from "./components/Layout";
import { notFoundComponent, routes } from "./lib/routes";

export function App() {
  const { Router, RouterProvider } = useCreateRoutes({
    routes,
    notFoundComponent,
  });

  return (
    <RouterProvider>
      <Layout>
        <Router />
      </Layout>
    </RouterProvider>
  );
}
