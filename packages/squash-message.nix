{ stdenvNoCC, deno }:

stdenvNoCC.mkDerivation rec {
  name = "squash-message";
  src = ../scripts;

  nativeBuildInputs = [ deno ];

  buildPhase = ''
    runHook preBuild

    # Cache directory for deno
    export DENO_DIR=.deno
    mkdir $DENO_DIR

    deno compile --allow-read --allow-net --allow-env ${name}.ts

    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall

    mkdir -p $out/bin
    cp ${name} $out/bin/

    runHook postInstall
  '';

  meta.mainProgram = name;
}
