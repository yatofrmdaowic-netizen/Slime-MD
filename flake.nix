{
  description = "Slime-MD development shell and runtime";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-24.05";

  outputs = { self, nixpkgs }:
    let
      systems = [ "x86_64-linux" "aarch64-linux" "x86_64-darwin" "aarch64-darwin" ];
      forAllSystems = f:
        nixpkgs.lib.genAttrs systems (system: f {
          pkgs = import nixpkgs { inherit system; };
        });
    in {
      devShells = forAllSystems ({ pkgs }: {
        default = pkgs.mkShell {
          packages = with pkgs; [
            nodejs_20
            nodePackages.npm
            python3
          ];

          shellHook = ''
            echo "Slime-MD nix shell ready"
            echo "Run: npm install && npm start"
          '';
        };
      });
    };
}
