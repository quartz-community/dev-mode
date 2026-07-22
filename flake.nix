{
  description = "Quartz v5 development environment";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs { inherit system; };
      in {
        devShells.default = pkgs.mkShell {
          buildInputs = with pkgs; [
            nodejs_22
            pnpm
            git
            just
            pkg-config
            vips
          ];

          shellHook = ''
            echo "Quartz v5 dev environment — Node $(node --version), pnpm $(pnpm --version)"
            export SHARP_IGNORE_GLOBAL_LIBVIPS=1
          '';
        };
      });
}
