// diffusers.js ships types but its package.json "exports" hides them from the
// bundler entrypoint — declare the slice we use.
declare module "@aislamov/diffusers.js" {
  export const DiffusionPipeline: {
    fromPretrained(model: string, opts?: any): Promise<any>;
  };
}
