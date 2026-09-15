import "three";

declare module "three" {
  interface WebGLRenderer {
    getContext(): WebGL2RenderingContext;
  }
}
