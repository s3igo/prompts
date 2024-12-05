{
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    systems.url = "github:nix-systems/default";
  };

  outputs =
    {
      nixpkgs,
      systems,
      ...
    }:

    let
      eachSystem = nixpkgs.lib.genAttrs (import systems);
      pkgsFor = eachSystem (system: import nixpkgs { inherit system; });
      mkOverlays =
        names:
        nixpkgs.lib.genAttrs names (
          name: final: prev: {
            ${name} = prev.callPackage ./packages/${name}.nix { };
          }
        );
    in

    {
      packages = eachSystem (
        system:
        with pkgsFor.${system};
        lib.packagesFromDirectoryRecursive {
          inherit callPackage;
          directory = ./packages;
        }
      );

      devShells = eachSystem (system: {
        default = with pkgsFor.${system}; mkShellNoCC { packages = [ deno ]; };
      });

      overlays = mkOverlays [ "squash-message" ];
    };
}
