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
        # Pinned to .node-version (remark-obsidian's dev dependencies need >= 22.23.4). The
        # version comes from the locked nixpkgs: `nix flake update nixpkgs` moves it, and this
        # check makes such a bump deliberate (update .node-version alongside).
        nodeVersion = pkgs.lib.strings.trim (builtins.readFile ./.node-version);
        nodejs =
          assert pkgs.lib.assertMsg (pkgs.nodejs_22.version == nodeVersion)
            "nixpkgs has nodejs_22 ${pkgs.nodejs_22.version}, but .node-version pins ${nodeVersion}";
          pkgs.nodejs_22;
      in {
        devShells.default = pkgs.mkShell {
          buildInputs = with pkgs; [
            nodejs
            pnpm
            git
            just
            pkg-config
            vips
            chromium
          ];

          shellHook = ''
            echo "Quartz v5 dev environment — Node $(node --version), pnpm $(pnpm --version)"
            export SHARP_IGNORE_GLOBAL_LIBVIPS=1
            export CHROME_BIN="${pkgs.chromium}/bin/chromium"
          '';
        };
      });
}
