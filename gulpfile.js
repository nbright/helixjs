var gulp = require('gulp');
var concat = require('gulp-concat');
var rename = require('gulp-rename');
var uglify = require('gulp-uglify');
var insert = require('gulp-insert');
var concatCallback = require('gulp-concat-callback');
var del = require('del');

var libs = [
    "libs/pako/pako_inflate.js"
];

var coreGLSLFiles = [
    './src/helix-core/glsl/**/*.glsl'
];

var coreFiles = [
    "src/helix-core/Helix.js",
    "src/helix-core/shader/ShaderLibrary.js",
    "./build/tmp/*.js",
    "src/helix-core/shader/glslinclude.js",

    "src/helix-core/math/*.js",
    "src/helix-core/core/*.js",
    "src/helix-core/io/FileUtils.js",
    "src/helix-core/io/URLLoader.js",
    "src/helix-core/io/BulkURLLoader.js",

    // base classes first
    "src/helix-core/shader/Shader.js",
    "src/helix-core/material/MaterialPass.js",
    "src/helix-core/material/Material.js",
    "src/helix-core/io/AssetLoader.js",
    "src/helix-core/scene/SceneNode.js",
    "src/helix-core/entity/*.js",
    "src/helix-core/shader/Effect.js",
    "src/helix-core/light/Light.js",
    "src/helix-core/light/ShadowFilter.js",
    "src/helix-core/scene/SceneVisitor.js",
    "src/helix-core/scene/BoundingVolume.js",
    "src/helix-core/animation/SkeletonBlendNode.js",
    "src/helix-core/animation/MorphBlendNode.js",
    "src/helix-core/mesh/Model.js",
    "src/helix-core/mesh/primitives/Primitive.js",

    "src/helix-core/**/*.js"
];

var ioFiles = [
    "src/helix-io/fbx/objects/FbxObject.js",
    "src/helix-io/fbx/objects/FbxNode.js",
    "src/helix-io/**/*.js"
];

gulp.task('package', ['glsl', 'main', 'clean']);

gulp.task('default', ['glsl', 'minimize', 'clean']);

// core only compiles the core game engine
gulp.task('core', ['glsl'], function ()
{
    var sources = libs.concat(coreFiles);
    return gulp.src(sources, {base: './'})
        .pipe(concat('helix.js'))
        .pipe(insert.append(appendHash()))
        .pipe(gulp.dest('./build/'));
});

gulp.task('io', [], function ()
{
    var sources = libs.concat(ioFiles);
    return gulp.src(sources, {base: './'})
        .pipe(concat('helix-io.js'))
        .pipe(gulp.dest('./build/'));
});

// main compiles everything, including optionals
gulp.task('main', ['core', 'io']);

gulp.task('minimize', ['main'], function ()
{
    gulp.src(['./build/helix.js', './build/helix-io.js'], {base: './build/'})
        .pipe(uglify())
        .pipe(rename({suffix: '.min'}))
        .pipe(gulp.dest('./build/'));
});

gulp.task('glsl', function ()
{
    return gulp.src(coreGLSLFiles)
        .pipe(concatCallback('shaderlib.js', appendGLSL))
        .pipe(gulp.dest('./build/tmp/'));
});

gulp.task('clean', ['main', 'glsl'], function ()
{
    del('./build/tmp');
});

function appendHash()
{
    var hash = Math.round(Math.random() * 0xffff).toString(16);
    return "HX.BUILD_HASH = 0x" + hash + ";\n";
}

function appendGLSL(contents, file)
{
    contents = contents.replace(/\n/g, "\\n");
    contents = contents.replace(/\r/g, "");
    contents = contents.replace(/\'/g, "\\'");
    contents = contents.replace(/\"/g, "\\\"");
    return "HX.ShaderLibrary['" + getFileName(file) + "'] = '" + contents + "';\n";
}

function getFileName(file)
{
    var index = file.path.lastIndexOf("\\");
    index = Math.max(file.path.lastIndexOf("/"), index);
    return index < 0 ? file.path : file.path.substring(index + 1);
}