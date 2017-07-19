import {MaterialPass} from "../MaterialPass";
import {ShaderLibrary} from "../../shader/ShaderLibrary";
import {Shader} from "../../shader/Shader";

/**
 * @ignore
 * @param geometryVertex
 * @param geometryFragment
 * @constructor
 *
 * @author derschmale <http://www.derschmale.com>
 */
function ForwardLitBasePass(geometryVertex, geometryFragment)
{
    MaterialPass.call(this, this._generateShader(geometryVertex, geometryFragment));
}

ForwardLitBasePass.prototype = Object.create(MaterialPass.prototype);

ForwardLitBasePass.prototype._generateShader = function(geometryVertex, geometryFragment)
{
    // no normals or specular are needed
    var defines =   "#define HX_SKIP_NORMALS\n" +
                    "#define HX_SKIP_SPECULAR\n";
    var fragmentShader = defines + ShaderLibrary.get("snippets_geometry.glsl") + "\n" + geometryFragment + "\n" + ShaderLibrary.get("material_fwd_base_fragment.glsl");
    var vertexShader = defines + geometryVertex + "\n" + ShaderLibrary.get("material_fwd_base_vertex.glsl");
    return new Shader(vertexShader, fragmentShader);
};

export { ForwardLitBasePass };