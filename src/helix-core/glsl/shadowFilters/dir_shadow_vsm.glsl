#derivatives

vec4 hx_dir_getShadowMapValue(float depth)
{
    float dx = dFdx(depth);
    float dy = dFdy(depth);
    float moment2 = depth * depth + 0.25*(dx*dx + dy*dy);

    #if defined(HX_HALF_FLOAT_TEXTURES_LINEAR) || defined(HX_FLOAT_TEXTURES_LINEAR)
    return vec4(depth, moment2, 0.0, 1.0);
    #else
    return vec4(hx_floatToRG8(depth), hx_floatToRG8(moment2));
    #endif
}

float hx_dir_readShadow(sampler2D shadowMap, vec3 viewPos, mat4 shadowMapMatrix, float depthBias)
{
    vec4 shadowMapCoord = shadowMapMatrix * vec4(viewPos, 1.0);
    vec4 s = texture2D(shadowMap, shadowMapCoord.xy);
    #if defined(HX_HALF_FLOAT_TEXTURES_LINEAR) || defined(HX_FLOAT_TEXTURES_LINEAR)
    vec2 moments = s.xy;
    #else
    vec2 moments = vec2(hx_RG8ToFloat(s.xy), hx_RG8ToFloat(s.zw));
    #endif
    shadowMapCoord.z += depthBias;

    float variance = moments.y - moments.x * moments.x;
    variance = max(variance, HX_DIR_VSM_MIN_VARIANCE);

    float diff = shadowMapCoord.z - moments.x;
    float upperBound = 1.0;

    // transparents could be closer to the light than casters
    if (diff > 0.0)
        upperBound = variance / (variance + diff*diff);

    return saturate((upperBound - HX_DIR_VSM_LIGHT_BLEED_REDUCTION) * HX_DIR_VSM_RCP_LIGHT_BLEED_REDUCTION_RANGE);
}