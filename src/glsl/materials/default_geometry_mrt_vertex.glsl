attribute vec4 hx_position;
attribute vec3 hx_normal;

uniform mat4 hx_wvpMatrix;
uniform mat3 hx_normalWorldViewMatrix;

varying vec3 normal;

#if defined(COLOR_MAP) || defined(NORMAL_MAP)|| defined(SPECULAR_MAP)|| defined(ROUGHNESS_MAP)
attribute vec2 hx_texCoord;
varying vec2 texCoords;
#endif

#ifdef NORMAL_MAP
attribute vec4 hx_tangent;

varying vec3 tangent;
varying vec3 bitangent;

uniform mat4 hx_worldViewMatrix;
#endif


void main()
{
    gl_Position = hx_wvpMatrix * hx_position;
    normal = hx_normalWorldViewMatrix * hx_normal;

#ifdef NORMAL_MAP
    tangent = mat3(hx_worldViewMatrix) * hx_tangent.xyz;
    bitangent = cross(tangent, normal) * hx_tangent.w;
#endif

#if defined(COLOR_MAP) || defined(NORMAL_MAP)|| defined(SPECULAR_MAP)|| defined(ROUGHNESS_MAP)
    texCoords = hx_texCoord;
#endif
}