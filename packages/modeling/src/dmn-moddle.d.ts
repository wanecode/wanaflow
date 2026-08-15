declare module "dmn-moddle" {
  export class DmnModdle {
    constructor(packages?: Record<string, unknown>, options?: Record<string, unknown>);
    fromXML(source: string): Promise<{
      rootElement: unknown;
      warnings?: unknown[];
      elementsById?: Record<string, unknown>;
    }>;
    toXML(element: unknown, options?: Record<string, unknown>): Promise<{ xml: string }>;
  }
}
