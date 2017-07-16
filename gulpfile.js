var gulp = require('gulp');
var concat = require('gulp-concat');
var rename = require('gulp-rename');
var uglify = require('gulp-uglify');
var insert = require('gulp-insert');
var concatCallback = require('gulp-concat-callback');
var del = require('del');
var rollup = require('gulp-better-rollup');
var jsdoc = require("gulp-jsdoc3");

gulp.task('package', ['glsl', 'main', 'clean']);

gulp.task('default', ['glsl', 'minimize', 'clean']);
gulp.task('docs', ['docs-core', 'docs-io']);

// core only compiles the core game engine
gulp.task('core', ['glsl'], function ()
{
    return gulp.src(['./src/helix-core/HX.js'])
        .pipe(rollup({
            moduleName: 'HX',
        }, 'umd'))
        .pipe(concat('helix.js'))
        .pipe(gulp.dest('./build/'));
});

gulp.task('io', [], function ()
{
    return gulp.src(['./src/helix-io/HX_IO.js'])
        .pipe(rollup({
            moduleName: 'HX',
            globals: {
                'helix': 'HX',
                'pako': 'pako'
            },
            external: [ 'helix', 'pako' ]
        }, 'umd'))
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
    return gulp.src('./src/helix-core/glsl/**/*.glsl')
        .pipe(concatCallback('shaderlib.js', appendGLSL))
        .pipe(insert.prepend("import { ShaderLibrary } from '../../src/helix-core/shader/ShaderLibrary';\n"))
        .pipe(gulp.dest('./build/tmp/'));
});

gulp.task('clean', ['main', 'glsl'], function ()
{
    del('./build/tmp');
});

gulp.task('docs-core', function (cb) {
    var config = require('./jsdoc-core.json');
    gulp.src(['README.md', './src/helix-core/**/*.js'], {read: false})
        .pipe(jsdoc(config, cb));
});

gulp.task('docs-io', function(cb) {
    var config = require('./jsdoc-io.json');
    gulp.src(['README.md', './src/helix-io/*.js'], {read: false})
        .pipe(jsdoc(config, cb));
});

function appendGLSL(contents, file)
{
    contents = contents.replace(/\n/g, "\\n");
    contents = contents.replace(/\r/g, "");
    contents = contents.replace(/\'/g, "\\'");
    contents = contents.replace(/\"/g, "\\\"");
    return "ShaderLibrary._files['" + getFileName(file) + "'] = '" + contents + "';\n";
}

function getFileName(file)
{
    var index = file.path.lastIndexOf("\\");
    index = Math.max(file.path.lastIndexOf("/"), index);
    return index < 0 ? file.path : file.path.substring(index + 1);
}